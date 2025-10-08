import crypto from "node:crypto";
import url from "node:url";
import type { Common } from "@/internal/common.js";
import type { Logger } from "@/internal/logger.js";
import type { Chain, SyncBlock, SyncBlockHeader } from "@/internal/types.js";
import {
  _eth_getBlockByHash,
  _eth_getBlockByNumber,
  standardizeBlock,
} from "@/rpc/actions.js";
import { createQueue } from "@/utils/queue.js";
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
  isHex,
  webSocket,
} from "viem";
import { WebSocket } from "ws";
import type { DebugRpcSchema } from "../utils/debug.js";

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
  request: <TParameters extends RequestParameters>(
    parameters: TParameters,
    context?: { logger?: Logger },
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
const MIN_RPS = 1;
const MAX_RPS = 500;
const RPS_INCREASE_FACTOR = 1.05;
const RPS_DECREASE_FACTOR = 0.95;
const RPS_INCREASE_QUALIFIER = 0.8;
const SUCCESS_WINDOW_SIZE = 100;

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

  requestTimestamps: number[];
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
  let backends: { request: EIP1193RequestFn<RpcSchema>; hostname: string }[];

  if (typeof chain.rpc === "string") {
    const protocol = new url.URL(chain.rpc).protocol;
    const hostname = new url.URL(chain.rpc).hostname;
    if (protocol === "https:" || protocol === "http:") {
      backends = [
        {
          request: http(chain.rpc)({
            chain: chain.viemChain,
            retryCount: 0,
            timeout: 5_000,
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
            timeout: 5_000,
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
        return {
          request: http(rpc)({
            chain: chain.viemChain,
            retryCount: 0,
            timeout: 5_000,
          }).request,
          hostname,
        };
      } else if (protocol === "wss:" || protocol === "ws:") {
        return {
          request: webSocket(rpc)({
            chain: chain.viemChain,
            retryCount: 0,
            timeout: 5_000,
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
          timeout: 5_000,
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

  const buckets = backends.map(
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

        requestTimestamps: [],
        consecutiveSuccessfulRequests: 0,
        rpsLimit: INITIAL_MAX_RPS,

        request,
      }) satisfies Bucket,
  );

  /** Tracks all active bucket reactivation timeouts to cleanup during shutdown */
  const timeouts = new Set<NodeJS.Timeout>();

  // TODO(kyle) log warn if no buckets are available

  const scheduleBucketActivation = (bucket: Bucket) => {
    const timeoutId = setTimeout(() => {
      bucket.isActive = true;
      bucket.isWarmingUp = true;
      timeouts.delete(timeoutId);
      common.logger.debug({
        msg: "JSON-RPC provider reactivated",
        chain: chain.name,
        hostname: bucket.hostname,
        retry_delay: Math.round(bucket.reactivationDelay),
      });
    }, bucket.reactivationDelay);

    common.logger.debug({
      msg: "JSON-RPC provider deactivated",
      chain: chain.name,
      hostname: bucket.hostname,
      retry_delay: Math.round(bucket.reactivationDelay),
    });

    timeouts.add(timeoutId);
  };

  const getBucket = async (): Promise<Bucket> => {
    const availableBuckets = buckets.filter(isAvailable);

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
        const bucket = await getBucket();
        const endClock = startClock();
        const id = crypto.randomUUID().slice(0, 8);

        try {
          logger.trace({
            msg: "Sent JSON-RPC request",
            chain: chain.name,
            hostname: bucket.hostname,
            request_id: id,
            method: body.method,
          });

          addRequestTimestamp(bucket);

          const response = await bucket.request(body);

          if (response === undefined) {
            throw new Error("Response is undefined");
          }

          const duration = endClock();

          logger.trace({
            msg: "Received JSON-RPC response",
            chain: chain.name,
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
            isHex(body.params[0].toBlock)
          ) {
            const getLogsErrorResponse = getLogsRetryHelper({
              params: body.params as GetLogsRetryHelperParameters["params"],
              error: error as RpcError,
            });

            if (getLogsErrorResponse.shouldRetry) {
              common.logger.trace({
                msg: "Caught eth_getLogs range error",
                chain: chain.name,
                hostname: bucket.hostname,
                request_id: id,
                method: body.method,
                request: JSON.stringify(body),
                retry_ranges: JSON.stringify(getLogsErrorResponse.ranges),
                error: error as Error,
              });

              throw error;
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

              decreaseMaxRPS(bucket);

              common.logger.debug({
                msg: "JSON-RPC provider rate limited",
                chain: chain.name,
                hostname: bucket.hostname,
                rps_limit: Math.floor(bucket.rpsLimit),
              });

              scheduleBucketActivation(bucket);

              // @ts-expect-error typescript bug
              if (buckets.every((b) => b.isActive === false)) {
                logger.warn({
                  msg: "All JSON-RPC providers are inactive",
                  chain: chain.name,
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
    // @ts-ignore
    request: (parameters, context) => queue.add({ body: parameters, context }),
    subscribe({ onBlock, onError }) {
      (async () => {
        while (true) {
          if (isUnsubscribed) return;
          let isFetching = false;

          if (chain.ws === undefined || webSocketErrorCount >= RETRY_COUNT) {
            common.logger.debug({
              msg: "Created JSON-RPC polling subscription",
              chain: chain.name,
            });

            interval = setInterval(async () => {
              if (isFetching) return;
              isFetching = true;
              try {
                const block = await _eth_getBlockByNumber(rpc, {
                  blockTag: "latest",
                });
                isFetching = false;
                // Note: `onBlock` should never throw.
                await onBlock(block);
              } catch (error) {
                isFetching = false;
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
                  });
                  webSocketErrorCount = 0;

                  onBlock(standardizeBlock(msg.params.result, true));
                } else if (msg.result) {
                  common.logger.debug({
                    msg: "Created JSON-RPC WebSocket subscription",
                    chain: chain.name,
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
