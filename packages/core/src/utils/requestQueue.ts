import type { Common } from "@/internal/common.js";
import { ShutdownError } from "@/internal/errors.js";
import type { Network } from "@/internal/types.js";
import { type Queue, createQueue } from "@/utils/queue.js";
import {
  type GetLogsRetryHelperParameters,
  getLogsRetryHelper,
} from "@ponder/utils";
import {
  type EIP1193Parameters,
  HttpRequestError,
  JsonRpcVersionUnsupportedError,
  MethodNotFoundRpcError,
  MethodNotSupportedRpcError,
  ParseRpcError,
  type PublicRpcSchema,
  type RpcError,
  isHex,
} from "viem";
import type { DebugRpcSchema } from "./debug.js";
import { startClock } from "./timer.js";
import { wait } from "./wait.js";

type Schema = [...PublicRpcSchema, ...DebugRpcSchema];

type RequestReturnType<method extends EIP1193Parameters<Schema>["method"]> =
  Extract<Schema[number], { Method: method }>["ReturnType"];

export type RequestQueue = Omit<
  Queue<
    RequestReturnType<EIP1193Parameters<Schema>["method"]>,
    EIP1193Parameters<Schema>
  >,
  "add"
> & {
  request: <TParameters extends EIP1193Parameters<Schema>>(
    parameters: TParameters,
  ) => Promise<RequestReturnType<TParameters["method"]>>;
};

const RETRY_COUNT = 9;
const BASE_DURATION = 125;

/**
 * Creates a queue to manage rpc requests.
 */
export const createRequestQueue = ({
  common,
  network,
  concurrency = 25,
}: {
  common: Common;
  network: Network;
  concurrency?: number;
}): RequestQueue => {
  // @ts-ignore
  const fetchRequest = async (request: EIP1193Parameters<PublicRpcSchema>) => {
    for (let i = 0; i <= RETRY_COUNT; i++) {
      try {
        const stopClock = startClock();
        if (common.shutdown.isKilled) {
          throw new ShutdownError();
        }
        common.logger.trace({
          service: "rpc",
          msg: `Sent ${request.method} request (params=${JSON.stringify(request.params)})`,
        });

        const response = await network.transport.request(request);
        common.metrics.ponder_rpc_request_duration.observe(
          { method: request.method, network: network.name },
          stopClock(),
        );
        if (common.shutdown.isKilled) {
          throw new ShutdownError();
        }

        common.logger.trace({
          service: "rpc",
          msg: `Received ${request.method} response (duration=${stopClock()}, params=${JSON.stringify(request.params)})`,
        });

        return response;
      } catch (_error) {
        const error = _error as Error;

        if (common.shutdown.isKilled) {
          throw new ShutdownError();
        }

        if (
          request.method === "eth_getLogs" &&
          isHex(request.params[0].fromBlock) &&
          isHex(request.params[0].toBlock)
        ) {
          const getLogsErrorResponse = getLogsRetryHelper({
            params: request.params as GetLogsRetryHelperParameters["params"],
            error: error as RpcError,
          });

          if (getLogsErrorResponse.shouldRetry === true) throw error;
        }

        if (shouldRetry(error) === false) {
          common.logger.warn({
            service: "rpc",
            msg: `Failed ${request.method} request`,
          });
          throw error;
        }

        if (i === RETRY_COUNT) {
          common.logger.warn({
            service: "rpc",
            msg: `Failed ${request.method} request after ${i + 1} attempts`,
            error,
          });
          throw error;
        }

        const duration = BASE_DURATION * 2 ** i;
        common.logger.debug({
          service: "rpc",
          msg: `Failed ${request.method} request, retrying after ${duration} milliseconds`,
          error,
        });
        await wait(duration);
      }
    }
  };

  const requestQueue: Queue<
    unknown,
    {
      request: EIP1193Parameters<PublicRpcSchema>;
      stopClockLag: () => number;
    }
  > = createQueue({
    frequency: network.maxRequestsPerSecond,
    concurrency,
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

      return await fetchRequest(task.request);
    },
  });

  return {
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
    // Invalid JSON
    if (error.code === ParseRpcError.code) return false;
    // Method does not exist
    if (error.code === MethodNotFoundRpcError.code) return false;
    // Method is not implemented
    if (error.code === MethodNotSupportedRpcError.code) return false;
    // Version of JSON-RPC protocol is not supported
    if (error.code === JsonRpcVersionUnsupportedError.code) return false;
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
