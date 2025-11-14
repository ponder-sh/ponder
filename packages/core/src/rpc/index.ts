import crypto, { type UUID } from "node:crypto";
import url from "node:url";
import type { Common } from "@/internal/common.js";
import type { Logger } from "@/internal/logger.js";
import type { Chain, SyncBlock, SyncBlockHeader } from "@/internal/types.js";
import { eth_getBlockByNumber, standardizeBlock } from "@/rpc/actions.js";
import { createQueue } from "@/utils/queue.js";
import { startClock } from "@/utils/timer.js";
import { wait } from "@/utils/wait.js";
import {
  type GetLogsRetryHelperParameters,
  getLogsRetryHelper,
} from "@ponder/utils";
import {
  BlockNotFoundError,
  type EIP1193Parameters,
  type EIP1193RequestFn,
  type Hash,
  HttpRequestError,
  JsonRpcVersionUnsupportedError,
  MethodNotFoundRpcError,
  MethodNotSupportedRpcError,
  ParseRpcError,
  type PublicRpcSchema,
  type RpcError,
  type RpcTransactionReceipt,
  TimeoutError,
  custom,
  hexToNumber,
  isHex,
  webSocket,
} from "viem";
import { WebSocket } from "ws";
import type { DebugRpcSchema } from "../utils/debug.js";
import { getHttpRpcClient } from "./http.js";

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

export type Rpc = {
  hostnames: string[];
  request: <TParameters extends RequestParameters>(
    parameters: TParameters,
    context?: { logger?: Logger; retryNullBlockRequest?: boolean },
  ) => Promise<RequestReturnType<TParameters["method"]>>;
  subscribe: (params: {
    onBlock: (block: SyncBlock | SyncBlockHeader) => Promise<boolean>;
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

  request: EIP1193RequestFn<RpcSchema>;
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
 */
const isAvailable = (bucket: Bucket) => {
  if (bucket.isActive === false) return false;

  const now = Math.floor(Date.now() / 1000);
  const currentRPS = bucket.rps.find((r) => r.timestamp === now);

  if (currentRPS && currentRPS.count + 1 > bucket.rpsLimit) {
    return false;
  }

  if (bucket.rps.length > 0 && bucket.rps[0]!.timestamp < now) {
    const elapsed = now - bucket.rps[0]!.timestamp;
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

export const createRpc = ({
  common,
  chain,
  concurrency = 25,
}: { common: Common; chain: Chain; concurrency?: number }): Rpc => {
  let backends: { request: EIP1193RequestFn<RpcSchema>; hostname: string }[];

  let requestId: UUID | undefined;

  if (typeof chain.rpc === "string") {
    const protocol = new url.URL(chain.rpc).protocol;
    const hostname = new url.URL(chain.rpc).hostname;
    if (protocol === "https:" || protocol === "http:") {
      const httpRpcClient = getHttpRpcClient(chain.rpc, {
        common,
        chain,
        timeout: 10_000,
      });
      backends = [
        {
          request: custom({
            request(body) {
              if (requestId) {
                return httpRpcClient.request({
                  body,
                  fetchOptions: { headers: { "X-Request-ID": requestId } },
                });
              }
              return httpRpcClient.request({ body });
            },
          })({
            chain: chain.viemChain,
            retryCount: 0,
          }).request,
          hostname,
        },
      ];
    } else if (protocol === "wss:" || protocol === "ws:") {
      backends = [
        {
          request: webSocket(chain.rpc)({
            chain: chain.viemChain,
            retryCount: 0,
            timeout: 10_000,
          }).request,
          hostname,
        },
      ];
    } else {
      throw new Error(`Unsupported RPC URL protocol: ${protocol}`);
    }
  } else if (Array.isArray(chain.rpc)) {
    backends = chain.rpc.map((rpc) => {
      const protocol = new url.URL(rpc).protocol;
      const hostname = new url.URL(chain.rpc).hostname;

      if (protocol === "https:" || protocol === "http:") {
        const httpRpcClient = getHttpRpcClient(rpc, {
          common,
          chain,
          timeout: 10_000,
        });
        return {
          request: custom({
            request(body) {
              if (requestId) {
                return httpRpcClient.request({
                  body,
                  fetchOptions: { headers: { "X-Request-ID": requestId } },
                });
              }
              return httpRpcClient.request({ body });
            },
          })({
            chain: chain.viemChain,
            retryCount: 0,
          }).request,
          hostname,
        };
      } else if (protocol === "wss:" || protocol === "ws:") {
        return {
          request: webSocket(rpc)({
            chain: chain.viemChain,
            retryCount: 0,
            timeout: 10_000,
          }).request,
          hostname,
        };
      } else {
        throw new Error(`Unsupported RPC URL protocol: ${protocol}`);
      }
    });
  } else {
    backends = [
      {
        request: chain.rpc({
          chain: chain.viemChain,
          retryCount: 0,
          timeout: 10_000,
        }).request,
        hostname: "custom_transport",
      },
    ];
  }

  if (typeof chain.ws === "string") {
    const protocol = new url.URL(chain.ws).protocol;

    if (protocol !== "wss:" && protocol !== "ws:") {
      throw new Error(
        `Inconsistent RPC URL protocol: ${protocol}. Expected wss or ws.`,
      );
    }
  }

  const buckets: Bucket[] = backends.map(
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

  let noAvailableBucketsTimer: NodeJS.Timeout | undefined;

  /** Tracks all active bucket reactivation timeouts to cleanup during shutdown */
  const timeouts = new Set<NodeJS.Timeout>();

  const scheduleBucketActivation = (bucket: Bucket) => {
    const delay = bucket.reactivationDelay;
    const timeoutId = setTimeout(() => {
      bucket.isActive = true;
      bucket.isWarmingUp = true;
      timeouts.delete(timeoutId);
      common.logger.debug({
        msg: "JSON-RPC provider reactivated after rate limiting",
        chain: chain.name,
        chain_id: chain.id,
        hostname: bucket.hostname,
        retry_delay: Math.round(delay),
      });
    }, delay);

    common.logger.debug({
      msg: "JSON-RPC provider deactivated due to rate limiting",
      chain: chain.name,
      chain_id: chain.id,
      hostname: bucket.hostname,
      retry_delay: Math.round(delay),
    });

    timeouts.add(timeoutId);
  };

  const getBucket = async (): Promise<Bucket> => {
    let availableBuckets: Bucket[];

    // Note: wait for the next event loop to ensure that the bucket rps are updated
    await new Promise((resolve) => setImmediate(resolve));

    while (true) {
      // Remove old request per second data
      const timestamp = Math.floor(Date.now() / 1000);
      for (const bucket of buckets) {
        bucket.rps = bucket.rps.filter((r) => r.timestamp > timestamp - 10);
      }

      availableBuckets = buckets.filter(isAvailable);

      if (availableBuckets.length > 0) {
        break;
      }

      if (noAvailableBucketsTimer === undefined) {
        noAvailableBucketsTimer = setTimeout(() => {
          common.logger.warn({
            msg: "All JSON-RPC providers are inactive due to rate limiting",
            chain: chain.name,
            chain_id: chain.id,
            rate_limits: JSON.stringify(buckets.map((b) => b.rpsLimit)),
          });
        }, 5_000);
      }

      await wait(20);
    }

    clearTimeout(noAvailableBucketsTimer);
    noAvailableBucketsTimer = undefined;

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

  const increaseMaxRPS = (bucket: Bucket) => {
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

    bucket.rpsLimit = Math.min(bucket.rpsLimit * RPS_INCREASE_FACTOR, MAX_RPS);
    bucket.consecutiveSuccessfulRequests = 0;

    common.logger.debug({
      msg: "Increased JSON-RPC provider RPS limit",
      chain: chain.name,
      chain_id: chain.id,
      hostname: bucket.hostname,
      rps_limit: Math.floor(bucket.rpsLimit),
    });
  };

  const queue = createQueue<
    Awaited<ReturnType<Rpc["request"]>>,
    {
      body: Parameters<Rpc["request"]>[0];
      context?: Parameters<Rpc["request"]>[1];
    }
  >({
    initialStart: true,
    concurrency,
    worker: async ({ body, context }) => {
      const logger = context?.logger ?? common.logger;

      for (let i = 0; i <= RETRY_COUNT; i++) {
        let endClock = startClock();
        const t = setTimeout(() => {
          logger.warn({
            msg: "Unable to find available JSON-RPC provider within expected time",
            chain: chain.name,
            chain_id: chain.id,
            rate_limit: JSON.stringify(buckets.map((b) => b.rpsLimit)),
            is_active: JSON.stringify(buckets.map((b) => b.isActive)),
            is_warming_up: JSON.stringify(buckets.map((b) => b.isWarmingUp)),
            duration: 15_000,
          });
        }, 15_000);
        const bucket = await getBucket();
        clearTimeout(t);
        const getBucketDuration = endClock();
        endClock = startClock();
        const id = crypto.randomUUID();

        const surpassTimeout = setTimeout(() => {
          logger.warn({
            msg: "JSON-RPC request unexpectedly surpassed timeout",
            chain: chain.name,
            chain_id: chain.id,
            hostname: bucket.hostname,
            request_id: id,
            method: body.method,
            duration: 15_000,
          });
        }, 15_000);

        try {
          logger.trace({
            msg: "Sent JSON-RPC request",
            chain: chain.name,
            chain_id: chain.id,
            hostname: bucket.hostname,
            request_id: id,
            method: body.method,
            duration: getBucketDuration,
          });

          // Add request per second data
          const timestamp = Math.floor(Date.now() / 1000);
          if (
            bucket.rps.length === 0 ||
            bucket.rps[bucket.rps.length - 1]!.timestamp < timestamp
          ) {
            bucket.rps.push({ count: 1, timestamp });
          } else {
            bucket.rps[bucket.rps.length - 1]!.count++;
          }

          requestId = id;
          const response = await bucket.request(body);

          if (response === undefined) {
            throw new Error("Response is undefined");
          }

          if (
            response === null &&
            (body.method === "eth_getBlockByNumber" ||
              body.method === "eth_getBlockByHash") &&
            context?.retryNullBlockRequest === true
          ) {
            // Note: Throwing this error will cause the request to be retried.
            throw new BlockNotFoundError({
              // @ts-ignore
              blockNumber: body.params[0],
            });
          }

          const duration = endClock();

          logger.trace({
            msg: "Received JSON-RPC response",
            chain: chain.name,
            chain_id: chain.id,
            hostname: bucket.hostname,
            request_id: id,
            method: body.method,
            duration,
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
            isHex(body.params[0].toBlock) &&
            chain.ethGetLogsBlockRange === undefined
          ) {
            const getLogsErrorResponse = getLogsRetryHelper({
              params: body.params as GetLogsRetryHelperParameters["params"],
              error: error as RpcError,
            });

            if (getLogsErrorResponse.shouldRetry) {
              common.logger.trace({
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

              throw error;
            } else {
              // @ts-ignore
              error.meta = [
                "Tip: Use the ethGetLogsBlockRange option to override the default behavior for this chain",
              ];
            }
          }

          addLatency(bucket, endClock(), false);

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

              bucket.rpsLimit = Math.max(
                bucket.rpsLimit * RPS_DECREASE_FACTOR,
                MIN_RPS,
              );
              bucket.consecutiveSuccessfulRequests = 0;

              common.logger.debug({
                msg: "JSON-RPC provider rate limited",
                chain: chain.name,
                chain_id: chain.id,
                hostname: bucket.hostname,
                rps_limit: Math.floor(bucket.rpsLimit),
              });

              scheduleBucketActivation(bucket);

              if (buckets.every((b) => b.isActive === false)) {
                logger.warn({
                  msg: "All JSON-RPC providers are inactive",
                  chain: chain.name,
                  chain_id: chain.id,
                });
              }

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
            logger.warn({
              msg: "Received JSON-RPC error",
              chain: chain.name,
              chain_id: chain.id,
              hostname: bucket.hostname,
              request_id: id,
              method: body.method,
              request: JSON.stringify(body),
              duration: endClock(),
              error,
            });
            throw error;
          }

          if (i === RETRY_COUNT) {
            logger.warn({
              msg: "Received JSON-RPC error",
              chain: chain.name,
              chain_id: chain.id,
              hostname: bucket.hostname,
              request_id: id,
              method: body.method,
              request: JSON.stringify(body),
              duration: endClock(),
              retry_count: i + 1,
              error,
            });
            throw error;
          }

          const duration = BASE_DURATION * 2 ** i;
          logger.warn({
            msg: "Received JSON-RPC error",
            chain: chain.name,
            chain_id: chain.id,
            hostname: bucket.hostname,
            request_id: id,
            method: body.method,
            request: JSON.stringify(body),
            duration: endClock(),
            retry_count: i + 1,
            retry_delay: duration,
            error,
          });
          await wait(duration);
        } finally {
          bucket.activeConnections--;

          clearTimeout(surpassTimeout);
        }
      }

      throw "unreachable";
    },
  });

  let ws: WebSocket | undefined;
  let isUnsubscribed = false;
  let subscriptionId: string | undefined;
  let webSocketErrorCount = 0;
  let interval: NodeJS.Timeout | undefined;

  const rpc: Rpc = {
    hostnames: backends.map((backend) => backend.hostname),
    // @ts-ignore
    request: (parameters, context) => queue.add({ body: parameters, context }),
    subscribe({ onBlock, onError }) {
      (async () => {
        while (true) {
          if (isUnsubscribed) return;

          if (chain.ws === undefined || webSocketErrorCount >= RETRY_COUNT) {
            common.logger.debug({
              msg: "Created JSON-RPC polling subscription",
              chain: chain.name,
              chain_id: chain.id,
              polling_interval: chain.pollingInterval,
            });

            interval = setInterval(async () => {
              try {
                const block = await eth_getBlockByNumber(rpc, ["latest", true]);
                common.logger.trace({
                  msg: "Received successful JSON-RPC polling response",
                  chain: chain.name,
                  chain_id: chain.id,
                  block_number: hexToNumber(block.number),
                  block_hash: block.hash,
                });
                // Note: `onBlock` should never throw.
                await onBlock(block);
              } catch (error) {
                onError(error as Error);
              }
            }, chain.pollingInterval);
            common.shutdown.add(() => {
              clearInterval(interval);
            });

            return;
          }

          await new Promise<void>((resolve) => {
            ws = new WebSocket(chain.ws!);

            ws.on("open", () => {
              common.logger.debug({
                msg: "Created JSON-RPC WebSocket connection",
                chain: chain.name,
                chain_id: chain.id,
              });

              const subscriptionRequest = {
                jsonrpc: "2.0",
                id: 1,
                method: "eth_subscribe",
                params: ["newHeads"],
              };

              ws?.send(JSON.stringify(subscriptionRequest));
            });

            ws.on("message", (data: Buffer) => {
              try {
                const msg = JSON.parse(data.toString());
                if (
                  msg.method === "eth_subscription" &&
                  msg.params.subscription === subscriptionId
                ) {
                  common.logger.trace({
                    msg: "Received successful JSON-RPC WebSocket subscription data",
                    chain: chain.name,
                    chain_id: chain.id,
                    block_number: msg.params.result.number
                      ? hexToNumber(msg.params.result.number)
                      : undefined,
                    block_hash: msg.params.result.hash,
                  });
                  webSocketErrorCount = 0;

                  onBlock(
                    standardizeBlock(msg.params.result, {
                      method: "eth_subscribe",
                      params: ["newHeads"],
                    }),
                  );
                } else if (msg.result) {
                  common.logger.debug({
                    msg: "Created JSON-RPC WebSocket subscription",
                    chain: chain.name,
                    chain_id: chain.id,
                    request: JSON.stringify({
                      method: "eth_subscribe",
                      params: ["newHeads"],
                    }),
                    subscription: msg.result,
                  });

                  subscriptionId = msg.result;
                } else if (msg.error) {
                  common.logger.warn({
                    msg: "Failed JSON-RPC WebSocket subscription",
                    chain: chain.name,
                    chain_id: chain.id,
                    request: JSON.stringify({
                      method: "eth_subscribe",
                      params: ["newHeads"],
                    }),
                    retry_count: webSocketErrorCount + 1,
                    error: msg.error as Error,
                  });

                  if (webSocketErrorCount < RETRY_COUNT) {
                    webSocketErrorCount += 1;
                  }

                  ws?.close();
                } else {
                  common.logger.warn({
                    msg: "Received unrecognized JSON-RPC WebSocket message",
                    chain: chain.name,
                    websocket_message: msg,
                  });
                }
              } catch (error) {
                common.logger.warn({
                  msg: "Failed JSON-RPC WebSocket subscription",
                  chain: chain.name,
                  chain_id: chain.id,
                  request: JSON.stringify({
                    method: "eth_subscribe",
                    params: ["newHeads"],
                  }),
                  retry_count: webSocketErrorCount + 1,
                  error: error as Error,
                });

                if (webSocketErrorCount < RETRY_COUNT) {
                  webSocketErrorCount += 1;
                }

                ws?.close();
              }
            });

            ws.on("error", async (error) => {
              common.logger.warn({
                msg: "Failed JSON-RPC WebSocket subscription",
                chain: chain.name,
                chain_id: chain.id,
                request: JSON.stringify({
                  method: "eth_subscribe",
                  params: ["newHeads"],
                }),
                retry_count: webSocketErrorCount + 1,
                error: error as Error,
              });

              if (webSocketErrorCount < RETRY_COUNT) {
                webSocketErrorCount += 1;
              }

              if (ws && ws.readyState === ws.OPEN) {
                ws.close();
              } else {
                resolve();
              }
            });

            ws.on("close", async () => {
              common.logger.debug({
                msg: "Closed JSON-RPC WebSocket connection",
                chain: chain.name,
                chain_id: chain.id,
              });

              ws = undefined;

              if (isUnsubscribed || webSocketErrorCount >= RETRY_COUNT) {
                resolve();
              } else {
                const duration = BASE_DURATION * 2 ** webSocketErrorCount;

                common.logger.debug({
                  msg: "Retrying JSON-RPC WebSocket connection",
                  chain: chain.name,
                  retry_count: webSocketErrorCount + 1,
                  retry_delay: duration,
                });

                await wait(duration);

                resolve();
              }
            });
          });
        }
      })();
    },
    async unsubscribe() {
      clearInterval(interval);
      isUnsubscribed = true;
      if (ws) {
        if (subscriptionId) {
          const unsubscribeRequest = {
            jsonrpc: "2.0",
            id: 1,
            method: "eth_unsubscribe",
            params: [subscriptionId],
          };

          common.logger.debug({
            msg: "Ended JSON-RPC WebSocket subscription",
            chain: chain.name,
            chain_id: chain.id,
            request: JSON.stringify({
              method: "eth_unsubscribe",
              params: [subscriptionId],
            }),
          });

          ws.send(JSON.stringify(unsubscribeRequest));
        }
        ws.close();
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
