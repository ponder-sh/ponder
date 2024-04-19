import type { Common } from "@/common/common.js";
import type { Network } from "@/config/networks.js";
import { type Queue, createQueue } from "@ponder/common";
import {
  type EIP1193Parameters,
  HttpRequestError,
  InternalRpcError,
  LimitExceededRpcError,
  type PublicRpcSchema,
} from "viem";
import { startClock } from "./timer.js";
import { wait } from "./wait.js";

type RequestReturnType<
  method extends EIP1193Parameters<PublicRpcSchema>["method"],
> = Extract<PublicRpcSchema[number], { Method: method }>["ReturnType"];

export type RequestQueue = Omit<
  Queue<
    RequestReturnType<EIP1193Parameters<PublicRpcSchema>["method"]>,
    EIP1193Parameters<PublicRpcSchema>
  >,
  "add"
> & {
  request: <TParameters extends EIP1193Parameters<PublicRpcSchema>>(
    parameters: TParameters,
  ) => Promise<RequestReturnType<TParameters["method"]>>;
};

/**
 * Creates a queue built to manage rpc requests.
 */
export const createRequestQueue = ({
  network,
  common,
}: {
  network: Network;
  common: Common;
}): RequestQueue => {
  const requestQueue = createQueue({
    frequency: network.maxRequestsPerSecond,
    concurrency: Math.ceil(network.maxRequestsPerSecond / 4),
    initialStart: true,
    browser: false,
    worker: async (task: {
      request: EIP1193Parameters<PublicRpcSchema>;
      stopClockLag: () => number;
    }) => {
      common.metrics.ponder_rpc_request_lag.observe(
        { method: task.request.method, network: network.name },
        task.stopClockLag(),
      );

      const stopClock = startClock();

      for (let i = 0; i < 4; i++) {
        try {
          const response = await network.transport.request(task.request);
          common.metrics.ponder_rpc_request_duration.observe(
            { method: task.request.method, network: network.name },
            stopClock(),
          );

          return response;
        } catch (_error) {
          const error = _error as Error;

          if (shouldRetry(error) === false || i === 3) {
            common.logger.error({
              msg: "Request failed",
              error,
            });
            // TODO(kyle) do we need this?
            throw error;
          } else {
            await wait(250 * 2 ** i);
          }
        }
      }
    },
  });

  return {
    ...requestQueue,
    request: <TParameters extends EIP1193Parameters<PublicRpcSchema>>(
      params: TParameters,
    ) => {
      const stopClockLag = startClock();

      return requestQueue.add({ request: params, stopClockLag });
    },
  } as RequestQueue;
};

/**
 * @link https://github.com/wevm/viem/blob/main/src/utils/buildRequest.ts#L192
 */
function shouldRetry(error: Error) {
  if ("code" in error && typeof error.code === "number") {
    if (error.code === -1) return true; // Unknown error
    if (error.code === LimitExceededRpcError.code) return true;
    if (error.code === InternalRpcError.code) return true;
    return false;
  }
  if (error instanceof HttpRequestError && error.status) {
    // Forbidden
    if (error.status === 403) return true;
    // Request Timeout
    if (error.status === 408) return true;
    // Request Entity Too Large
    if (error.status === 413) return true;
    // Too Many Requests
    if (error.status === 429) return true;
    // Internal Server Error
    if (error.status === 500) return true;
    // Bad Gateway
    if (error.status === 502) return true;
    // Service Unavailable
    if (error.status === 503) return true;
    // Gateway Timeout
    if (error.status === 504) return true;
    return false;
  }
  return true;
}
