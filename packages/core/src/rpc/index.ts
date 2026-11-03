import url from "node:url";
import {
  type GetLogsRetryHelperParameters,
  getLogsRetryHelper,
} from "@ponder/utils";
import {
  Clock,
  Effect,
  Exit,
  Fiber,
  FiberSet,
  Option,
  Queue,
  Random,
  Result,
  type Scope,
  Semaphore,
  Stream,
} from "effect";
import {
  type EIP1193Parameters,
  type Hash,
  hexToNumber,
  isHex,
  type LogTopic,
  type PublicRpcSchema,
  type RpcError,
  type RpcTransactionReceipt,
} from "viem";
import { Metrics } from "@/internal/metrics.js";
import { Options } from "@/internal/options.js";
import type { Chain, SyncBlock, SyncBlockHeader } from "@/internal/types.js";
import {
  BlockNotFoundError,
  eth_getBlockByNumber,
  standardizeBlock,
  TransactionReceiptNotFoundError,
} from "@/rpc/actions.js";
import { randomUUID } from "@/utils/random.js";
import { startClockEffect } from "@/utils/timer.js";
import type { DebugRpcSchema } from "../utils/debug.js";
import { makeHttpTransport } from "./http.js";
import {
  makeCustomTransport,
  RpcNetworkError,
  type RpcSubscribeTransport,
  RpcTimeoutError,
  type RpcTransport,
  type RpcTransportError,
} from "./transport.js";
import { makeWebSocketTransport, WebSocketClosedError } from "./webSocket.js";

export type RpcSchema = [
  ...PublicRpcSchema,
  ...DebugRpcSchema,
  /**
   * @description Returns the receipts of a block specified by hash
   *
   * @example
   * provider.request({ method: 'eth_getBlockReceipts', params: ['0x...'] })
   * // => [{ ... }, { ... }]
   */
  {
    Method: "eth_getBlockReceipts";
    Parameters: [hash: Hash];
    ReturnType: RpcTransactionReceipt[] | null;
  },
];

export type RequestParameters = EIP1193Parameters<RpcSchema>;

export type RequestReturnType<
  method extends EIP1193Parameters<RpcSchema>["method"],
> = Extract<RpcSchema[number], { Method: method }>["ReturnType"];

export const sanitizeLogTopics = <
  topics extends readonly LogTopic[] | LogTopic[],
>(
  topics: topics,
) => {
  const sanitizedTopics = [...topics];
  while (sanitizedTopics.at(-1) === null) sanitizedTopics.pop();

  return sanitizedTopics as topics;
};

export type RequestContext = {
  /** Annotations for the logs of the request, such as `{ action: "fetch_block_data" }`. */
  logAnnotations?: Record<string, unknown>;
  /** Retry when the block or receipt in a request is `null`. */
  retryNullBlockRequest?: boolean;
  /**
   * Retries of a `null` block or receipt, instead of the retries of an
   * error.
   */
  nullBlockRetryCount?: number;
};

export type Rpc = {
  hostnames: string[];
  request: <TParameters extends RequestParameters>(
    parameters: TParameters,
    context?: RequestContext,
  ) => Effect.Effect<RequestReturnType<TParameters["method"]>, Error>;
  /**
   * Stream of new blocks, from a WebSocket `newHeads` subscription, or from
   * polling the latest block. A failed poll is emitted as a failure, and
   * polling continues.
   *
   * @dev Each run of the stream has its own subscription, which ends when the
   * stream ends.
   */
  subscribe: Stream.Stream<Result.Result<SyncBlock | SyncBlockHeader, Error>>;
};

const RETRY_COUNT = 9;
const BASE_DURATION = 125;
const INITIAL_REACTIVATION_DELAY = 100;
const MAX_REACTIVATION_DELAY = 5_000;
const BACKOFF_FACTOR = 1.5;
const LATENCY_WINDOW_SIZE = 500;
/** Hurdle rate for switching to a faster bucket. */
const LATENCY_HURDLE_RATE = 0.1;
/** Exploration rate. */
const EPSILON = 0.1;
const INITIAL_MAX_RPS = 20;
const MIN_RPS = 3;
const MAX_RPS = 500;
const RPS_INCREASE_FACTOR = 1.05;
const RPS_DECREASE_FACTOR = 0.95;
const RPS_INCREASE_QUALIFIER = 0.9;
const SUCCESS_MULTIPLIER = 5;

type Bucket = {
  index: number;
  hostname: string;
  /** Reactivation delay in milliseconds. */
  reactivationDelay: number;
  /** Number of active connections. */
  activeConnections: number;
  /** Is the bucket available to send requests. */
  isActive: boolean;
  /** Is the bucket recently activated and yet to complete successful requests. */
  isWarmingUp: boolean;

  latencyMetadata: {
    latencies: { value: number; success: boolean }[];

    successfulLatencies: number;
    latencySum: number;
  };
  expectedLatency: number;

  rps: { count: number; timestamp: number }[];
  /** Number of consecutive successful requests. */
  consecutiveSuccessfulRequests: number;
  /** Maximum requests per second (dynamic). */
  rpsLimit: number;

  request: RpcTransport["request"];
};

const addLatency = (bucket: Bucket, latency: number, success: boolean) => {
  bucket.latencyMetadata.latencies.push({ value: latency, success });
  bucket.latencyMetadata.latencySum += latency;
  if (success) {
    bucket.latencyMetadata.successfulLatencies++;
  }

  if (bucket.latencyMetadata.latencies.length > LATENCY_WINDOW_SIZE) {
    const record = bucket.latencyMetadata.latencies.shift()!;
    bucket.latencyMetadata.latencySum -= record.value;
    if (record.success) {
      bucket.latencyMetadata.successfulLatencies--;
    }
  }

  bucket.expectedLatency =
    bucket.latencyMetadata.latencySum /
    bucket.latencyMetadata.successfulLatencies;
};

/**
 * Return `true` if the bucket is available to send a request.
 *
 * @param now The current time in milliseconds.
 */
const isAvailable = (bucket: Bucket, now: number) => {
  if (bucket.isActive === false) return false;

  const timestamp = Math.floor(now / 1000);
  const currentRPS = bucket.rps.find((r) => r.timestamp === timestamp);

  if (currentRPS && currentRPS.count + 1 > bucket.rpsLimit) {
    return false;
  }

  if (bucket.rps.length > 0 && bucket.rps[0]!.timestamp < timestamp) {
    const elapsed = timestamp - bucket.rps[0]!.timestamp;
    const totalCount = bucket.rps.reduce((acc, rps) => acc + rps.count, 0);

    if (totalCount > bucket.rpsLimit * (1 + elapsed)) {
      return false;
    }
  }

  if (bucket.isWarmingUp && bucket.activeConnections > 3) {
    return false;
  }

  return true;
};

/**
 * Run `onSlow` if `effect` takes longer than `duration` milliseconds.
 */
const warnIfSlow =
  (duration: number, onSlow: Effect.Effect<void>) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(
        Effect.sleep(duration).pipe(Effect.andThen(onSlow)),
      );
      return yield* effect.pipe(Effect.ensuring(Fiber.interrupt(fiber)));
    });

/**
 * The transports of a chain: one for each JSON-RPC provider, and the
 * connection for `eth_subscribe`, if any.
 */
export type RpcTransports = {
  transports: RpcTransport[];
  /**
   * Connect for `eth_subscribe` to new heads. Without it, the chain polls for
   * new blocks.
   */
  subscribe:
    | Effect.Effect<RpcSubscribeTransport, RpcTransportError, Scope.Scope>
    | undefined;
};

/**
 * Create the transports of the `rpc` and `ws` of `chain`. WebSocket
 * connections close when the scope closes.
 */
export const makeRpcTransports = (
  chain: Chain,
): Effect.Effect<RpcTransports, Error, Scope.Scope> =>
  Effect.gen(function* () {
    const transports: RpcTransport[] = [];

    if (typeof chain.rpc === "string" || Array.isArray(chain.rpc)) {
      const rpcs = typeof chain.rpc === "string" ? [chain.rpc] : chain.rpc;
      for (const rpc of rpcs) {
        const protocol = new url.URL(rpc).protocol;

        if (protocol === "https:" || protocol === "http:") {
          transports.push(makeHttpTransport(rpc, { chain, timeout: 10_000 }));
        } else if (protocol === "wss:" || protocol === "ws:") {
          transports.push(
            yield* makeWebSocketTransport(rpc, { chain, timeout: 10_000 }),
          );
        } else {
          return yield* Effect.fail(
            new Error(`Unsupported RPC URL protocol: ${protocol}`),
          );
        }
      }
    } else {
      transports.push(
        makeCustomTransport(
          chain.rpc({
            chain: chain.viemChain,
            retryCount: 0,
            timeout: 10_000,
          }).request,
        ),
      );
    }

    if (chain.ws === undefined) return { transports, subscribe: undefined };

    const protocol = new url.URL(chain.ws).protocol;
    if (protocol !== "wss:" && protocol !== "ws:") {
      return yield* Effect.fail(
        new Error(
          `Inconsistent RPC URL protocol: ${protocol}. Expected wss or ws.`,
        ),
      );
    }

    return {
      transports,
      subscribe: makeWebSocketTransport(chain.ws, { chain, timeout: 10_000 }),
    };
  });

/**
 * Create a JSON-RPC client for each chain, with the transports of its config.
 *
 * @dev The clients stop when the scope closes.
 */
export const createRpcs = (
  chains: Chain[],
): Effect.Effect<Rpc[], Error, Metrics | Options | Scope.Scope> =>
  Effect.gen(function* () {
    const options = yield* Options;
    return yield* Effect.forEach(chains, (chain) =>
      Effect.flatMap(makeRpcTransports(chain), (transports) =>
        createRpc({
          chain,
          ...transports,
          concurrency: Math.floor(options.rpcMaxConcurrency / chains.length),
        }),
      ),
    );
  });

/**
 * Create a load-balanced JSON-RPC client for `chain`, over `transports`.
 *
 * @dev Reactivation timers and subscriptions stop when the scope closes.
 */
export const createRpc = ({
  chain,
  transports,
  subscribe,
  concurrency = 25,
}: {
  chain: Chain;
  concurrency?: number;
} & RpcTransports): Effect.Effect<Rpc, never, Metrics | Scope.Scope> =>
  Effect.gen(function* () {
    const metrics = yield* Metrics;
    /** Background fibers that stop when the scope closes. */
    const fibers = yield* FiberSet.make();

    const buckets: Bucket[] = transports.map(
      ({ request, hostname }, index) =>
        ({
          index,
          hostname,
          reactivationDelay: INITIAL_REACTIVATION_DELAY,

          activeConnections: 0,
          isActive: true,
          isWarmingUp: false,

          latencyMetadata: {
            latencies: [],
            successfulLatencies: 0,
            latencySum: 0,
          },
          expectedLatency: 200,

          rps: [],
          consecutiveSuccessfulRequests: 0,
          rpsLimit: INITIAL_MAX_RPS,

          request,
        }) satisfies Bucket,
    );

    let noAvailableBucketsFiber: Fiber.Fiber<void> | undefined;

    const scheduleBucketActivation = (bucket: Bucket) =>
      Effect.gen(function* () {
        const delay = bucket.reactivationDelay;
        yield* FiberSet.run(
          fibers,
          Effect.sleep(delay).pipe(
            Effect.andThen(
              Effect.gen(function* () {
                bucket.isActive = true;
                bucket.isWarmingUp = true;
                yield* Effect.logDebug({
                  msg: "JSON-RPC provider reactivated after rate limiting",
                  chain: chain.name,
                  chain_id: chain.id,
                  hostname: bucket.hostname,
                  retry_delay: Math.round(delay),
                });
              }),
            ),
          ),
        );

        yield* Effect.logDebug({
          msg: "JSON-RPC provider deactivated due to rate limiting",
          chain: chain.name,
          chain_id: chain.id,
          hostname: bucket.hostname,
          retry_delay: Math.round(delay),
        });
      });

    /**
     * Wait for an available bucket. `previous` is the bucket of the failed
     * attempt that is retried.
     */
    const getBucket = Effect.fnUntraced(function* (previous?: Bucket) {
      let availableBuckets: Bucket[];

      // Note: wait for the next event loop to ensure that the bucket rps are updated
      yield* Effect.yieldNow;

      while (true) {
        // Remove old request per second data
        const now = yield* Clock.currentTimeMillis;
        const timestamp = Math.floor(now / 1000);
        for (const bucket of buckets) {
          bucket.rps = bucket.rps.filter((r) => r.timestamp > timestamp - 10);
        }

        availableBuckets = buckets.filter((bucket) => isAvailable(bucket, now));

        if (availableBuckets.length > 0) {
          break;
        }

        if (noAvailableBucketsFiber === undefined) {
          noAvailableBucketsFiber = yield* FiberSet.run(
            fibers,
            Effect.sleep(5_000).pipe(
              Effect.andThen(
                Effect.gen(function* () {
                  yield* Effect.logWarning({
                    msg: "All JSON-RPC providers are inactive due to rate limiting",
                    chain: chain.name,
                    chain_id: chain.id,
                    rate_limits: JSON.stringify(buckets.map((b) => b.rpsLimit)),
                  });
                }),
              ),
            ),
          );
        }

        yield* Effect.sleep(20);
      }

      if (noAvailableBucketsFiber !== undefined) {
        const fiber = noAvailableBucketsFiber;
        noAvailableBucketsFiber = undefined;
        yield* Fiber.interrupt(fiber);
      }

      // Note: A retry goes to another bucket if one is available. The failed
      // bucket is often still the fastest, and active again after the backoff.
      if (previous !== undefined && availableBuckets.length > 1) {
        availableBuckets = availableBuckets.filter((b) => b !== previous);
      }

      if ((yield* Random.next) < EPSILON) {
        const randomBucket =
          availableBuckets[
            Math.floor((yield* Random.next) * availableBuckets.length)
          ]!;
        randomBucket.activeConnections++;
        return randomBucket;
      }

      const fastestBucket = availableBuckets.reduce((fastest, current) => {
        const currentLatency = current.expectedLatency;
        const fastestLatency = fastest.expectedLatency;

        if (currentLatency < fastestLatency * (1 - LATENCY_HURDLE_RATE)) {
          return current;
        }

        if (
          currentLatency <= fastestLatency &&
          current.activeConnections < fastest.activeConnections
        ) {
          return current;
        }

        return fastest;
      }, availableBuckets[0]!);

      fastestBucket.activeConnections++;
      return fastestBucket;
    });

    const increaseMaxRPS = (bucket: Bucket) =>
      Effect.gen(function* () {
        if (bucket.rps.length < 10) return;

        if (
          bucket.consecutiveSuccessfulRequests <
          bucket.rpsLimit * SUCCESS_MULTIPLIER
        ) {
          return;
        }

        for (const { count } of bucket.rps) {
          if (count < bucket.rpsLimit * RPS_INCREASE_QUALIFIER) {
            return;
          }
        }

        bucket.rpsLimit = Math.min(
          bucket.rpsLimit * RPS_INCREASE_FACTOR,
          MAX_RPS,
        );
        bucket.consecutiveSuccessfulRequests = 0;

        yield* Effect.logDebug({
          msg: "Increased JSON-RPC provider RPS limit",
          chain: chain.name,
          chain_id: chain.id,
          hostname: bucket.hostname,
          rps_limit: Math.floor(bucket.rpsLimit),
        });
      });

    const semaphore = yield* Semaphore.make(concurrency);

    const request = (
      body: RequestParameters,
      context: Parameters<Rpc["request"]>[1],
    ): Effect.Effect<unknown, Error> =>
      Effect.gen(function* () {
        const log = (log: Effect.Effect<void>) =>
          context?.logAnnotations
            ? Effect.annotateLogs(log, context.logAnnotations)
            : log;

        let previous: Bucket | undefined;

        for (let i = 0; i <= RETRY_COUNT; i++) {
          let endClock = yield* startClockEffect;
          const bucket = yield* getBucket(previous).pipe(
            warnIfSlow(
              15_000,
              log(
                Effect.logWarning({
                  msg: "Unable to find available JSON-RPC provider within expected time",
                  chain: chain.name,
                  chain_id: chain.id,
                  rate_limit: JSON.stringify(buckets.map((b) => b.rpsLimit)),
                  is_active: JSON.stringify(buckets.map((b) => b.isActive)),
                  is_warming_up: JSON.stringify(
                    buckets.map((b) => b.isWarmingUp),
                  ),
                  duration: 15_000,
                }),
              ),
            ),
          );
          const getBucketDuration = yield* endClock;
          endClock = yield* startClockEffect;
          const id = yield* randomUUID;

          // Note: Resolves to `None` to retry the request.
          const response = yield* Effect.gen(function* () {
            yield* log(
              Effect.logTrace({
                msg: "Sent JSON-RPC request",
                chain: chain.name,
                chain_id: chain.id,
                hostname: bucket.hostname,
                request_id: id,
                method: body.method,
                duration: getBucketDuration,
              }),
            );

            // Add request per second data
            const timestamp = Math.floor(
              (yield* Clock.currentTimeMillis) / 1000,
            );
            if (
              bucket.rps.length === 0 ||
              bucket.rps[bucket.rps.length - 1]!.timestamp < timestamp
            ) {
              bucket.rps.push({ count: 1, timestamp });
            } else {
              bucket.rps[bucket.rps.length - 1]!.count++;
            }

            const result = yield* bucket.request(body, id).pipe(
              Effect.flatMap((response) => {
                if (response === undefined) {
                  return Effect.fail(new Error("Response is undefined"));
                }

                if (
                  response === null &&
                  (body.method === "eth_getBlockByNumber" ||
                    body.method === "eth_getBlockByHash" ||
                    body.method === "eth_getBlockReceipts") &&
                  context?.retryNullBlockRequest === true
                ) {
                  // Note: Failing with this error will cause the request to be retried.
                  return Effect.fail(
                    new BlockNotFoundError({
                      blockNumber: body.params[0],
                    }),
                  );
                }

                if (
                  response === null &&
                  body.method === "eth_getTransactionReceipt" &&
                  context?.retryNullBlockRequest === true
                ) {
                  // Note: Failing with this error will cause the request to be retried.
                  return Effect.fail(
                    new TransactionReceiptNotFoundError({
                      hash: body.params[0],
                    }),
                  );
                }

                return Effect.succeed(response);
              }),
              Effect.result,
            );

            if (Result.isSuccess(result)) {
              const duration = yield* endClock;

              yield* log(
                Effect.logTrace({
                  msg: "Received JSON-RPC response",
                  chain: chain.name,
                  chain_id: chain.id,
                  hostname: bucket.hostname,
                  request_id: id,
                  method: body.method,
                  duration,
                }),
              );

              metrics.ponder_rpc_request_duration.observe(
                { method: body.method, chain: chain.name },
                duration,
              );

              addLatency(bucket, duration, true);

              bucket.consecutiveSuccessfulRequests++;
              yield* increaseMaxRPS(bucket);

              bucket.isWarmingUp = false;
              bucket.reactivationDelay = INITIAL_REACTIVATION_DELAY;

              return Option.some(result.success);
            }

            const error = result.failure;

            metrics.ponder_rpc_request_error_total.inc(
              { method: body.method, chain: chain.name },
              1,
            );

            if (
              body.method === "eth_getLogs" &&
              isHex(body.params[0].fromBlock) &&
              isHex(body.params[0].toBlock) &&
              chain.ethGetLogsBlockRange === undefined
            ) {
              const getLogsErrorResponse = getLogsRetryHelper({
                params: body.params as GetLogsRetryHelperParameters["params"],
                error: error as RpcError,
              });

              if (getLogsErrorResponse.shouldRetry) {
                yield* Effect.logTrace({
                  msg: "Caught eth_getLogs range error",
                  chain: chain.name,
                  chain_id: chain.id,
                  hostname: bucket.hostname,
                  request_id: id,
                  method: body.method,
                  request: JSON.stringify(body),
                  retry_ranges: JSON.stringify(getLogsErrorResponse.ranges),
                  error: error as Error,
                });

                return yield* Effect.fail(error);
              } else {
                // @ts-expect-error
                error.meta = [
                  "Tip: Use the ethGetLogsBlockRange option to override the default behavior for this chain",
                ];
              }
            }

            addLatency(bucket, yield* endClock, false);

            if (
              // @ts-expect-error
              error.code === 429 ||
              // @ts-expect-error
              error.status === 429 ||
              isTimeoutError(error)
            ) {
              if (bucket.isActive) {
                bucket.isActive = false;
                bucket.isWarmingUp = false;

                bucket.rpsLimit = Math.max(
                  bucket.rpsLimit * RPS_DECREASE_FACTOR,
                  MIN_RPS,
                );
                bucket.consecutiveSuccessfulRequests = 0;

                yield* Effect.logDebug({
                  msg: "JSON-RPC provider rate limited",
                  chain: chain.name,
                  chain_id: chain.id,
                  hostname: bucket.hostname,
                  rps_limit: Math.floor(bucket.rpsLimit),
                });

                yield* scheduleBucketActivation(bucket);

                if (buckets.every((b) => b.isActive === false)) {
                  yield* log(
                    Effect.logWarning({
                      msg: "All JSON-RPC providers are inactive",
                      chain: chain.name,
                      chain_id: chain.id,
                    }),
                  );
                }

                bucket.reactivationDelay = isTimeoutError(error)
                  ? INITIAL_REACTIVATION_DELAY
                  : Math.min(
                      bucket.reactivationDelay * BACKOFF_FACTOR,
                      MAX_REACTIVATION_DELAY,
                    );
              }
            }

            if (shouldRetry(error) === false) {
              yield* log(
                Effect.logWarning({
                  msg: "Received JSON-RPC error",
                  chain: chain.name,
                  chain_id: chain.id,
                  hostname: bucket.hostname,
                  request_id: id,
                  method: body.method,
                  request: JSON.stringify(body),
                  duration: yield* endClock,
                  error,
                }),
              );
              return yield* Effect.fail(error);
            }

            if (
              i === RETRY_COUNT ||
              ((error instanceof BlockNotFoundError ||
                error instanceof TransactionReceiptNotFoundError ||
                isUnknownBlockHashError(body, error)) &&
                i >= (context?.nullBlockRetryCount ?? RETRY_COUNT))
            ) {
              yield* log(
                Effect.logWarning({
                  msg: "Received JSON-RPC error",
                  chain: chain.name,
                  chain_id: chain.id,
                  hostname: bucket.hostname,
                  request_id: id,
                  method: body.method,
                  request: JSON.stringify(body),
                  duration: yield* endClock,
                  retry_count: i + 1,
                  error,
                }),
              );
              return yield* Effect.fail(error);
            }

            const duration = BASE_DURATION * 2 ** i;
            yield* log(
              Effect.logWarning({
                msg: "Received JSON-RPC error",
                chain: chain.name,
                chain_id: chain.id,
                hostname: bucket.hostname,
                request_id: id,
                method: body.method,
                request: JSON.stringify(body),
                duration: yield* endClock,
                retry_count: i + 1,
                retry_delay: duration,
                error,
              }),
            );
            yield* Effect.sleep(duration);

            return Option.none();
          }).pipe(
            warnIfSlow(
              15_000,
              log(
                Effect.logWarning({
                  msg: "JSON-RPC request unexpectedly surpassed timeout",
                  chain: chain.name,
                  chain_id: chain.id,
                  hostname: bucket.hostname,
                  request_id: id,
                  method: body.method,
                  duration: 15_000,
                }),
              ),
            ),
            Effect.ensuring(
              Effect.sync(() => {
                bucket.activeConnections--;
              }),
            ),
          );

          if (Option.isSome(response)) return response.value;
          previous = bucket;
        }

        return yield* Effect.die("unreachable");
      }).pipe(semaphore.withPermits(1));

    const rpc: Rpc = {
      hostnames: transports.map((transport) => transport.hostname),
      // @ts-expect-error
      request,
      subscribe: Stream.callback<
        Result.Result<SyncBlock | SyncBlockHeader, Error>
      >((queue) =>
        Effect.gen(function* () {
          /** Polls run in the background, so a slow poll doesn't delay the next one. */
          const polls = yield* FiberSet.make();
          let webSocketErrorCount = 0;

          while (true) {
            if (subscribe === undefined || webSocketErrorCount >= RETRY_COUNT) {
              yield* Effect.logDebug({
                msg: "Created JSON-RPC polling subscription",
                chain: chain.name,
                chain_id: chain.id,
                polling_interval: chain.pollingInterval,
              });

              const poll = eth_getBlockByNumber(rpc, ["latest", true]).pipe(
                Effect.tap((block) =>
                  Effect.logTrace({
                    msg: "Received successful JSON-RPC polling response",
                    chain: chain.name,
                    chain_id: chain.id,
                    block_number: hexToNumber(block.number),
                    block_hash: block.hash,
                  }),
                ),
                Effect.result,
                Effect.flatMap((result) => Queue.offer(queue, result)),
              );

              return yield* Effect.sleep(chain.pollingInterval).pipe(
                Effect.andThen(FiberSet.run(polls, poll)),
                Effect.forever,
              );
            }

            const request = JSON.stringify({
              method: "eth_subscribe",
              params: ["newHeads"],
            });
            let isConnected = false;

            // Note: The subscription only ends by failing, or when the stream ends.
            const result = yield* Effect.scoped(
              Effect.gen(function* () {
                const transport = yield* subscribe;
                const subscription = yield* transport
                  .subscribe(["newHeads"])
                  .pipe(
                    Effect.tapError((error) =>
                      Effect.sync(() => {
                        isConnected = error._tag !== "RpcNetworkError";
                      }),
                    ),
                  );
                isConnected = true;

                yield* Effect.logDebug({
                  msg: "Created JSON-RPC WebSocket subscription",
                  chain: chain.name,
                  chain_id: chain.id,
                  request,
                  subscription: subscription.id,
                });
                yield* Effect.addFinalizer((exit) =>
                  Exit.hasInterrupts(exit)
                    ? Effect.logDebug({
                        msg: "Ended JSON-RPC WebSocket subscription",
                        chain: chain.name,
                        chain_id: chain.id,
                        request: JSON.stringify({
                          method: "eth_unsubscribe",
                          params: [subscription.id],
                        }),
                      })
                    : Effect.void,
                );

                yield* subscription.notifications.pipe(
                  Stream.runForEach((header: any) =>
                    Effect.gen(function* () {
                      webSocketErrorCount = 0;

                      const block = yield* Effect.try({
                        try: () =>
                          standardizeBlock(header, {
                            method: "eth_subscribe",
                            params: ["newHeads"],
                          }),
                        catch: (error) => error as Error,
                      });
                      yield* Effect.logTrace({
                        msg: "Received successful JSON-RPC WebSocket subscription data",
                        chain: chain.name,
                        chain_id: chain.id,
                        block_number: hexToNumber(block.number),
                        block_hash: block.hash,
                      });
                      yield* Queue.offer(queue, Result.succeed(block));
                    }),
                  ),
                );
              }).pipe(
                Effect.tapError((error) =>
                  isClosed(error)
                    ? Effect.void
                    : Effect.logWarning({
                        msg: "Failed JSON-RPC WebSocket subscription",
                        chain: chain.name,
                        chain_id: chain.id,
                        request,
                        retry_count: webSocketErrorCount + 1,
                        error,
                      }),
                ),
              ),
            ).pipe(Effect.result);

            if (Result.isSuccess(result)) continue;

            // Note: A connection that closes without an error is reconnected,
            // but doesn't count as a failed subscription.
            if (
              isClosed(result.failure) === false &&
              webSocketErrorCount < RETRY_COUNT
            ) {
              webSocketErrorCount += 1;
            }

            if (webSocketErrorCount < RETRY_COUNT) {
              const duration = BASE_DURATION * 2 ** webSocketErrorCount;

              yield* Effect.logDebug({
                msg: "Retrying JSON-RPC WebSocket connection",
                chain: chain.name,
                retry_count: webSocketErrorCount + 1,
                retry_delay: duration,
              });

              // Note: A connection that fails to open is retried immediately.
              if (isConnected) yield* Effect.sleep(duration);
            }
          }
        }),
      ),
    };

    return rpc;
  });

/**
 * Return `true` if `error` is a WebSocket connection that closed without an error.
 */
const isClosed = (error: Error) =>
  error instanceof RpcNetworkError &&
  error.cause instanceof WebSocketClosedError;

/**
 * Return `true` if `error` is a timeout.
 *
 * @dev Custom transports throw viem's `TimeoutError`.
 */
const isTimeoutError = (error: Error) =>
  error instanceof RpcTimeoutError || error.name === "TimeoutError";

/** JSON-RPC error codes that fail the same way when retried. */
const NON_RETRYABLE_CODES = new Set([
  // Invalid JSON
  -32700,
  // Method does not exist
  -32601,
  // Method is not implemented
  -32004,
  // Version of JSON-RPC protocol is not supported
  -32006,
]);

/** HTTP statuses that fail the same way when retried. */
const NON_RETRYABLE_STATUSES = new Set([
  // Not Found
  404,
  // Method Not Allowed
  405,
  // Not Implemented
  501,
  // HTTP Version Not Supported
  505,
]);

/**
 * Return `true` if retrying the request can succeed.
 *
 * @dev Reads `code` and `status`, so it also applies to the viem errors that
 * custom transports throw.
 *
 * @link https://github.com/wevm/viem/blob/main/src/utils/buildtask.ts#L192
 */
function shouldRetry(error: Error) {
  if ("code" in error && typeof error.code === "number") {
    if (NON_RETRYABLE_CODES.has(error.code)) return false;
    // eth_call reverted
    if (error.message.includes("revert")) return false;
  }
  if ("status" in error && typeof error.status === "number") {
    if (NON_RETRYABLE_STATUSES.has(error.status)) return false;
  }
  return true;
}

/**
 * Return `true` if the error of an `eth_getLogs` request by block hash means
 * that the RPC doesn't have the block, such as a block that it hasn't received
 * yet or that was reorged out.
 */
function isUnknownBlockHashError(body: RequestParameters, error: Error) {
  if (body.method !== "eth_getLogs" || body.params[0].blockHash === undefined) {
    return false;
  }

  const details =
    "details" in error && typeof error.details === "string"
      ? error.details
      : error.message;
  return /unknown block|block not found|header not found/i.test(details);
}
