import url from "node:url";
import type { Common } from "@/internal/common.js";
import type { Chain, SyncBlock, SyncBlockHeader } from "@/internal/types.js";
import type { RealtimeSync } from "@/sync-realtime/index.js";
import { createQueue } from "@/utils/queue.js";
import { _eth_getBlockByHash, _eth_getBlockByNumber } from "@/utils/rpc.js";
import { startClock } from "@/utils/timer.js";
import { wait } from "@/utils/wait.js";
import {
  type GetLogsRetryHelperParameters,
  getLogsRetryHelper,
} from "@ponder/utils";
import {
  http,
  type EIP1193Parameters,
  type EIP1193RequestFn,
  HttpRequestError,
  JsonRpcVersionUnsupportedError,
  MethodNotFoundRpcError,
  MethodNotSupportedRpcError,
  ParseRpcError,
  type PublicRpcSchema,
  type RpcError,
  TimeoutError,
  type WebSocketTransport,
  isHex,
  webSocket,
} from "viem";
import type { DebugRpcSchema } from "../utils/debug.js";

type Schema = [...PublicRpcSchema, ...DebugRpcSchema];

type RequestReturnType<method extends EIP1193Parameters<Schema>["method"]> =
  Extract<Schema[number], { Method: method }>["ReturnType"];

export type Rpc = {
  request: <TParameters extends EIP1193Parameters<Schema>>(
    parameters: TParameters,
  ) => Promise<RequestReturnType<TParameters["method"]>>;
  subscribe: (params: {
    onBlock: (
      block: SyncBlock | SyncBlockHeader,
    ) => ReturnType<RealtimeSync["sync"]>;
    onError: (error: Error) => void;
  }) => void;
  unsubscribe: () => Promise<void>;
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
const MIN_RPS = 1;
const MAX_RPS = 500;
const RPS_INCREASE_FACTOR = 1.2;
const RPS_DECREASE_FACTOR = 0.7;
const RPS_INCREASE_QUALIFIER = 0.8;
const SUCCESS_WINDOW_SIZE = 100;

type Bucket = {
  index: number;
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

  requestTimestamps: number[];
  /** Number of consecutive successful requests. */
  consecutiveSuccessfulRequests: number;
  /** Maximum requests per second (dynamic). */
  rpsLimit: number;

  request: EIP1193RequestFn;
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

const addRequestTimestamp = (bucket: Bucket) => {
  const timestamp = Date.now() / 1000;
  bucket.requestTimestamps.push(timestamp);
  while (timestamp - bucket.requestTimestamps[0]! > 5) {
    bucket.requestTimestamps.shift()!;
  }
};

/**
 * Calculate the requests per second for a bucket
 * using historical request timestamps.
 */
const getRPS = (bucket: Bucket) => {
  const timestamp = Date.now() / 1000;
  while (
    bucket.requestTimestamps.length > 0 &&
    timestamp - bucket.requestTimestamps[0]! > 5
  ) {
    bucket.requestTimestamps.shift()!;
  }

  if (bucket.requestTimestamps.length === 0) return 0;

  const t =
    bucket.requestTimestamps[bucket.requestTimestamps.length - 1]! -
    bucket.requestTimestamps[0]! +
    1;
  return bucket.requestTimestamps.length / t;
};

/**
 * Return `true` if the bucket is available to send a request.
 */
const isAvailable = (bucket: Bucket) => {
  if (bucket.isActive && getRPS(bucket) < bucket.rpsLimit) return true;

  if (bucket.isActive && bucket.isWarmingUp && bucket.activeConnections < 3) {
    return true;
  }

  return false;
};

const increaseMaxRPS = (bucket: Bucket) => {
  if (
    bucket.consecutiveSuccessfulRequests >= SUCCESS_WINDOW_SIZE &&
    getRPS(bucket) > bucket.rpsLimit * RPS_INCREASE_QUALIFIER
  ) {
    const newRPSLimit = Math.min(
      bucket.rpsLimit * RPS_INCREASE_FACTOR,
      MAX_RPS,
    );
    bucket.rpsLimit = newRPSLimit;
    bucket.consecutiveSuccessfulRequests = 0;
  }
};

const decreaseMaxRPS = (bucket: Bucket) => {
  const newRPSLimit = Math.max(bucket.rpsLimit * RPS_DECREASE_FACTOR, MIN_RPS);
  bucket.rpsLimit = newRPSLimit;
  bucket.consecutiveSuccessfulRequests = 0;
};

export const createRpc = ({
  common,
  chain,
  concurrency = 25,
}: { common: Common; chain: Chain; concurrency?: number }): Rpc => {
  let request: EIP1193RequestFn[];

  if (typeof chain.rpc === "string") {
    const protocol = new url.URL(chain.rpc).protocol;
    if (protocol === "https:" || protocol === "http:") {
      request = [
        http(chain.rpc)({
          chain: chain.viemChain,
          retryCount: 0,
          timeout: 5_000,
        }).request,
      ];
    } else if (protocol === "wss:" || protocol === "ws:") {
      request = [
        webSocket(chain.rpc)({
          chain: chain.viemChain,
          retryCount: 0,
          timeout: 5_000,
        }).request,
      ];
    } else {
      throw new Error(`Unsupported RPC URL protocol: ${protocol}`);
    }
  } else if (Array.isArray(chain.rpc)) {
    request = chain.rpc.map((rpc) => {
      const protocol = new url.URL(rpc).protocol;
      if (protocol === "https:" || protocol === "http:") {
        return http(rpc)({
          chain: chain.viemChain,
          retryCount: 0,
          timeout: 5_000,
        }).request;
      } else if (protocol === "wss:" || protocol === "ws:") {
        return webSocket(rpc)({
          chain: chain.viemChain,
          retryCount: 0,
          timeout: 5_000,
        }).request;
      } else {
        throw new Error(`Unsupported RPC URL protocol: ${protocol}`);
      }
    });
  } else {
    request = [
      chain.rpc({
        chain: chain.viemChain,
        retryCount: 0,
        timeout: 5_000,
      }).request,
    ];
  }

  let wsTransport: ReturnType<WebSocketTransport> | undefined = undefined;

  if (typeof chain.ws === "string") {
    const protocol = new url.URL(chain.ws).protocol;

    if (protocol === "wss:" || protocol === "ws:") {
      wsTransport = webSocket(chain.ws, { keepAlive: true, reconnect: false })({
        chain: chain.viemChain,
        retryCount: 0,
        timeout: 5_000,
      });
    } else {
      throw new Error(
        `Inconsistent RPC URL protocol: ${protocol}. Expected wss or ws.`,
      );
    }
  }

  const buckets = request.map(
    (request, index) =>
      ({
        index,
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

        requestTimestamps: [],
        consecutiveSuccessfulRequests: 0,
        rpsLimit: INITIAL_MAX_RPS,

        request,
      }) satisfies Bucket,
  );

  /** Tracks all active bucket reactivation timeouts to cleanup during shutdown */
  const timeouts = new Set<NodeJS.Timeout>();

  const scheduleBucketActivation = (bucket: Bucket) => {
    const timeoutId = setTimeout(() => {
      bucket.isActive = true;
      bucket.isWarmingUp = true;
      timeouts.delete(timeoutId);
      common.logger.debug({
        service: "rpc",
        msg: `RPC bucket ${bucket.index} reactivated for chain '${chain.name}' after ${Math.round(bucket.reactivationDelay)}ms`,
      });
    }, bucket.reactivationDelay);

    common.logger.debug({
      service: "rpc",
      msg: `RPC bucket '${chain.name}' ${bucket.index} deactivated for chain '${chain.name}'. Reactivation scheduled in ${Math.round(bucket.reactivationDelay)}ms`,
    });

    timeouts.add(timeoutId);
  };

  const getBucket = async (): Promise<Bucket> => {
    const availableBuckets = buckets.filter((b) => isAvailable(b));

    if (availableBuckets.length === 0) {
      await wait(10);
      return getBucket();
    }

    if (Math.random() < EPSILON) {
      const randomBucket =
        availableBuckets[Math.floor(Math.random() * availableBuckets.length)]!;
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
  };

  const queue = createQueue<
    Awaited<ReturnType<Rpc["request"]>>,
    Parameters<Rpc["request"]>[0]
  >({
    initialStart: true,
    concurrency,
    worker: async (body) => {
      for (let i = 0; i <= RETRY_COUNT; i++) {
        const bucket = await getBucket();

        const stopClock = startClock();
        try {
          common.logger.trace({
            service: "rpc",
            msg: `Sent '${chain.name}' ${body.method} request (params=${JSON.stringify(body.params)})`,
          });

          addRequestTimestamp(bucket);

          const response = await bucket.request(body);

          if (response === undefined) {
            throw new Error("Response is undefined");
          }

          const duration = stopClock();

          common.logger.trace({
            service: "rpc",
            msg: `Received '${chain.name}' ${body.method} response (duration=${duration}, params=${JSON.stringify(body.params)})`,
          });
          common.metrics.ponder_rpc_request_duration.observe(
            { method: body.method, chain: chain.name },
            duration,
          );

          addLatency(bucket, duration, true);

          bucket.consecutiveSuccessfulRequests++;
          increaseMaxRPS(bucket);

          bucket.isWarmingUp = false;
          bucket.reactivationDelay = INITIAL_REACTIVATION_DELAY;

          return response as RequestReturnType<typeof body.method>;
        } catch (e) {
          const error = e as Error;

          common.metrics.ponder_rpc_request_error_total.inc(
            { method: body.method, chain: chain.name },
            1,
          );

          if (
            body.method === "eth_getLogs" &&
            isHex(body.params[0].fromBlock) &&
            isHex(body.params[0].toBlock)
          ) {
            const getLogsErrorResponse = getLogsRetryHelper({
              params: body.params as GetLogsRetryHelperParameters["params"],
              error: error as RpcError,
            });

            if (getLogsErrorResponse.shouldRetry === true) throw error;
          }

          addLatency(bucket, stopClock(), false);

          if (
            // @ts-ignore
            error.code === 429 ||
            // @ts-ignore
            error.status === 429 ||
            error instanceof TimeoutError
          ) {
            if (bucket.isActive) {
              bucket.isActive = false;
              bucket.isWarmingUp = false;

              decreaseMaxRPS(bucket);

              scheduleBucketActivation(bucket);

              bucket.reactivationDelay =
                error instanceof TimeoutError
                  ? INITIAL_REACTIVATION_DELAY
                  : Math.min(
                      bucket.reactivationDelay * BACKOFF_FACTOR,
                      MAX_REACTIVATION_DELAY,
                    );
            }
          }

          if (shouldRetry(error) === false) {
            common.logger.warn({
              service: "rpc",
              msg: `Failed '${chain.name}' ${body.method} request`,
            });
            throw error;
          }

          if (i === RETRY_COUNT) {
            common.logger.warn({
              service: "rpc",
              msg: `Failed '${chain.name}' ${body.method} request after ${i + 1} attempts`,
              error,
            });
            throw error;
          }

          const duration = BASE_DURATION * 2 ** i;
          common.logger.debug({
            service: "rpc",
            msg: `Failed '${chain.name}' ${body.method} request, retrying after ${duration} milliseconds`,
            error,
          });
          await wait(duration);
        } finally {
          bucket.activeConnections--;
        }
      }

      throw "unreachable";
    },
  });

  let interval: NodeJS.Timeout | undefined;
  let webSocketErrorCount = 0;
  let isWebSocketClosing = false;
  const disconnect = async () => {
    const conn = await wsTransport!.value!.getRpcClient();
    isWebSocketClosing = true;
    conn.close();
  };

  const rpc: Rpc = {
    // @ts-ignore
    request: queue.add,
    subscribe({ onBlock, onError }) {
      if (wsTransport === undefined) {
        interval = setInterval(() => {
          _eth_getBlockByNumber(rpc, { blockTag: "latest" })
            .then(onBlock)
            .catch(onError);
        }, chain.pollingInterval);
        common.shutdown.add(() => {
          clearInterval(interval);
        });
      } else {
        wsTransport
          .value!.subscribe({
            params: ["newHeads"],
            onData: async (data) => {
              if (data.error || data.result === undefined) {
                const error = data.error as Error;
                webSocketErrorCount++;

                if (webSocketErrorCount === RETRY_COUNT) {
                  common.logger.warn({
                    service: "rpc",
                    msg: `Failed '${chain.name}' eth_subscribe after ${webSocketErrorCount + 1} consecutive errors. Switching to polling.`,
                    error,
                  });

                  await disconnect();

                  wsTransport = undefined;

                  rpc.subscribe({ onBlock, onError });
                } else {
                  common.logger.debug({
                    service: "rpc",
                    msg: `Failed '${chain.name}' eth_subscribe request`,
                    error,
                  });
                }
              }

              onBlock(data.result);
              webSocketErrorCount = 0;
            },
            onError: async (_error) => {
              // Note: `disconnect` causes `onError` to be called again.
              if (isWebSocketClosing) {
                isWebSocketClosing = false;
                return;
              }

              const error = _error as Error;
              webSocketErrorCount += 1;

              if (webSocketErrorCount === RETRY_COUNT) {
                common.logger.warn({
                  service: "rpc",
                  msg: `Failed '${chain.name}' eth_subscribe request after ${webSocketErrorCount + 1} consecutive errors. Switching to polling.`,
                  error,
                });

                await disconnect();

                wsTransport = undefined;
              } else {
                common.logger.debug({
                  service: "rpc",
                  msg: `Failed '${chain.name}' eth_subscribe request`,
                  error,
                });

                const conn = await wsTransport!.value!.getRpcClient();
                isWebSocketClosing = true;
                conn.close();
              }

              rpc.subscribe({ onBlock, onError });
            },
          })
          .then(() => {
            webSocketErrorCount = 0;
          })
          .catch(async (err) => {
            const error = err as Error;
            webSocketErrorCount += 1;

            if (webSocketErrorCount === RETRY_COUNT) {
              common.logger.warn({
                service: "rpc",
                msg: `Failed '${chain.name}' eth_subscribe after ${webSocketErrorCount + 1} consecutive errors. Switching to polling.`,
                error,
              });
              wsTransport = undefined;
            } else {
              const duration = BASE_DURATION * 2 ** webSocketErrorCount;
              common.logger.debug({
                service: "rpc",
                msg: `Failed '${chain.name}' eth_subscribe request, retrying after ${duration} milliseconds.`,
                error,
              });
              await wait(duration);
            }

            rpc.subscribe({ onBlock, onError });
          });
      }
    },
    async unsubscribe() {
      clearInterval(interval);
      if (wsTransport) {
        await disconnect();
      }
    },
  };

  common.shutdown.add(() => {
    for (const timeoutId of timeouts) {
      clearTimeout(timeoutId);
    }
    timeouts.clear();
  });

  return rpc;
};

/**
 * @link https://github.com/wevm/viem/blob/main/src/utils/buildtask.ts#L192
 */
function shouldRetry(error: Error) {
  if ("code" in error && typeof error.code === "number") {
    // Invalid JSON
    if (error.code === ParseRpcError.code) return false;
    // Method does not exist
    if (error.code === MethodNotFoundRpcError.code) return false;
    // Method is not implemented
    if (error.code === MethodNotSupportedRpcError.code) return false;
    // Version of JSON-RPC protocol is not supported
    if (error.code === JsonRpcVersionUnsupportedError.code) return false;
    // eth_call reverted
    if (error.message.includes("revert")) return false;
  }
  if (error instanceof HttpRequestError && error.status) {
    // Method Not Allowed
    if (error.status === 405) return false;
    // Not Found
    if (error.status === 404) return false;
    // Not Implemented
    if (error.status === 501) return false;
    // HTTP Version Not Supported
    if (error.status === 505) return false;
  }
  return true;
}
