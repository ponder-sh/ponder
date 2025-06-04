import url from "node:url";
import type { Common } from "@/internal/common.js";
import type { Chain, SyncBlock } from "@/internal/types.js";
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
    onBlock: (block: SyncBlock) => ReturnType<RealtimeSync["sync"]>;
    onError: (error: Error) => void;
  }) => void;
  unsubscribe: () => void;
};

const RETRY_COUNT = 9;
const BASE_DURATION = 125;

const INITIAL_RETRY_DELAY = 2_000;
const MAX_RETRY_DELAY = 30_000;
const BACKOFF_FACTOR = 2;
const LATENCY_WINDOW_SIZE = 500;
/** Hurdle rate for switching to a faster bucket. */
const LATENCY_HURDLE_RATE = 0.1;
/** Exploration rate. */
const EPSILON = 0.1;

// RPS management
const INITIAL_MAX_RPS = 50;
const MIN_RPS = 1;
const MAX_RPS = 500;
const RPS_INCREASE_FACTOR = 1.2;
const RPS_DECREASE_FACTOR = 0.7;
const RPS_INCREASE_QUALIFIER = 0.8;
const SUCCESS_WINDOW_SIZE = 100;

type Bucket = {
  index: number;
  retryDelay: number;

  activeConnections: number;
  isActive: boolean;
  isJustActivated: boolean;

  latencyMetadata: {
    latencies: { value: number; success: boolean }[];

    successfulLatencies: number;
    latencySum: number;
  };
  expectedLatency: number;

  requestTimestamps: number[];
  consecutiveSuccessfulRequests: number;
  rpsLimit: number;

  totalSuccessfulRequests: number;
  totalFailedRequests: number;

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

const isRPSSafe = (bucket: Bucket) => {
  return getRPS(bucket) < bucket.rpsLimit;
};

const isAvailable = (bucket: Bucket) => {
  return (
    bucket.isActive &&
    // if bucket just activated, let active connections go down and open only one connection for probing
    (!bucket.isJustActivated || bucket.activeConnections === 0) &&
    // if bucket below maxRPS
    isRPSSafe(bucket)
  );
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
    // console.log(
    //   `Bucket ${bucket.index} increasing max RPS from ${bucket.rpsLimit.toFixed(2)} to ${newRPSLimit.toFixed(2)} after ${bucket.consecutiveSuccessfulRequests} consecutive successful requests`,
    // );
    bucket.rpsLimit = newRPSLimit;
    bucket.consecutiveSuccessfulRequests = 0;
  }
};

const decreaseMaxRPS = (bucket: Bucket) => {
  const newRPSLimit = Math.max(bucket.rpsLimit * RPS_DECREASE_FACTOR, MIN_RPS);
  // console.log(
  //   `Bucket ${bucket.index} decreasing max RPS from ${bucket.rpsLimit.toFixed(2)} to ${newRPSLimit.toFixed(2)} due to rate limit`,
  // );
  bucket.rpsLimit = newRPSLimit;
  bucket.consecutiveSuccessfulRequests = 0;
};

export const createRpc = ({
  common,
  chain,
  concurrency = 25,
}: { common: Common; chain: Chain; concurrency?: number }): Rpc => {
  let request: EIP1193RequestFn[];
  common.metrics.rpc_usage[chain.name] = Array.from({
    length: Array.isArray(chain.rpc) ? chain.rpc.length : 1,
  }).map(() => ({ failedRequests: 0, totalRequests: 0 }));

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

  let ws_subscribe:
    | NonNullable<ReturnType<WebSocketTransport>["value"]>["subscribe"]
    | undefined = undefined;

  if (typeof chain.ws === "string") {
    const protocol = new url.URL(chain.ws).protocol;

    if (protocol === "wss:" || protocol === "ws:") {
      ws_subscribe = webSocket(chain.ws)({
        chain: chain.viemChain,
        retryCount: 0,
        timeout: 5_000,
      }).value?.subscribe;
    } else {
      throw new Error(
        `Inconsistent RPC URL protocol: ${protocol}. Expected wss or ws.`,
      );
    }
  }

  const buckets: Bucket[] = request.map((request, index) => ({
    index,
    retryDelay: 0,

    activeConnections: 0,
    isActive: true,
    isJustActivated: false,

    latencyMetadata: {
      latencies: [],
      successfulLatencies: 0,
      latencySum: 0,
    },
    expectedLatency: 200,

    requestTimestamps: [],
    consecutiveSuccessfulRequests: 0,
    rpsLimit: INITIAL_MAX_RPS,

    totalSuccessfulRequests: 0,
    totalFailedRequests: 0,

    request,
  }));

  const scheduleBucketActivation = (bucket: Bucket) => {
    setTimeout(() => {
      bucket.isActive = true;
      bucket.isJustActivated = true;
      // console.log(
      //   `Bucket ${bucket.index} reactivated after ${bucket.retryDelay}ms delay`,
      // );
    }, bucket.retryDelay);
  };

  const getBucket = async (): Promise<Bucket> => {
    const availableBuckets = buckets.filter((b) => isAvailable(b));

    if (availableBuckets.length === 0) {
      const rpsSafePromise = new Promise<void>((resolve) => {
        const checkRPSSafe = () => {
          const availableBucket = buckets.find((b) => isAvailable(b));
          if (availableBucket) {
            resolve();
          } else {
            setTimeout(checkRPSSafe, 10); // Check every 10ms
          }
        };
        checkRPSSafe();
      });

      await rpsSafePromise;

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
    // @ts-ignore
    worker: async (body) => {
      for (let i = 0; i <= RETRY_COUNT; i++) {
        const bucket = await getBucket();

        const stopClock = startClock();
        try {
          common.logger.trace({
            service: "rpc",
            msg: `Sent ${body.method} request (params=${JSON.stringify(body.params)})`,
          });

          addRequestTimestamp(bucket);
          common.metrics.rpc_usage[chain.name]![bucket.index]!.totalRequests++;
          const response = await bucket.request(body);
          // TODO(kyle) can response be undefined

          common.logger.trace({
            service: "rpc",
            msg: `Received ${body.method} response (duration=${stopClock()}, params=${JSON.stringify(body.params)})`,
          });
          common.metrics.ponder_rpc_request_duration.observe(
            { method: body.method, chain: chain.name },
            stopClock(),
          );

          addLatency(bucket, stopClock(), true);

          // Update RPS metadata
          bucket.totalSuccessfulRequests++;
          bucket.consecutiveSuccessfulRequests++;
          increaseMaxRPS(bucket);

          if (bucket.isJustActivated) {
            bucket.isJustActivated = false;
          }
          if (bucket.isActive && bucket.retryDelay > 0) {
            bucket.retryDelay = 0;
          }

          return response as RequestReturnType<typeof body.method>;
        } catch (e) {
          const error = e as Error;
          common.metrics.rpc_usage[chain.name]![bucket.index]!.failedRequests++;

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
          bucket.totalFailedRequests++;

          if (
            // @ts-ignore
            error.code === 429 ||
            // @ts-ignore
            error.status === 429 ||
            error instanceof TimeoutError
          ) {
            if (bucket.isActive) {
              bucket.isActive = false;
              bucket.isJustActivated = false;

              decreaseMaxRPS(bucket);

              bucket.retryDelay =
                bucket.retryDelay === 0 || error instanceof TimeoutError
                  ? INITIAL_RETRY_DELAY
                  : Math.min(
                      bucket.retryDelay * BACKOFF_FACTOR,
                      MAX_RETRY_DELAY,
                    );

              scheduleBucketActivation(bucket);
            }
          }

          if (shouldRetry(error) === false) {
            common.logger.warn({
              service: "rpc",
              msg: `Failed ${body.method} request`,
            });
            throw error;
          }

          if (i === RETRY_COUNT) {
            common.logger.warn({
              service: "rpc",
              msg: `Failed ${body.method} request after ${i + 1} attempts`,
              error,
            });
            throw error;
          }

          const duration = BASE_DURATION * 2 ** i;
          common.logger.debug({
            service: "rpc",
            msg: `Failed ${body.method} request, retrying after ${duration} milliseconds`,
            error,
          });
          await wait(duration);
        } finally {
          bucket.activeConnections--;
        }
      }
    },
  });

  let interval: NodeJS.Timeout | undefined;

  const rpc: Rpc = {
    // @ts-ignore
    request: queue.add,
    subscribe({ onBlock, onError }) {
      if (ws_subscribe === undefined) {
        interval = setInterval(() => {
          _eth_getBlockByNumber(rpc, { blockTag: "latest" })
            .then(onBlock)
            .catch(onError);
        }, chain.pollingInterval);
        common.shutdown.add(() => {
          clearInterval(interval);
        });
      } else {
        ws_subscribe({
          params: ["newHeads"],
          onData: (data) => {
            _eth_getBlockByHash(rpc, { hash: data.result.hash })
              .then(onBlock)
              .catch(onError);
          },
          onError: (err) => {
            const error = err as Error;
            console.log(error);
          },
        });
      }
    },
    unsubscribe() {
      clearInterval(interval);
    },
  };

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
