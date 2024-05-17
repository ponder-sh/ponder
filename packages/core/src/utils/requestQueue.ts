import type { Common } from "@/common/common.js";
import type { Network } from "@/config/networks.js";
import { type Queue, createQueue } from "@ponder/common";
import {
  type GetLogsRetryHelperParameters,
  getLogsRetryHelper,
} from "@ponder/utils";
import {
  BlockNotFoundError,
  type EIP1193Parameters,
  HttpRequestError,
  InternalRpcError,
  InvalidInputRpcError,
  LimitExceededRpcError,
  type PublicRpcSchema,
  RpcError,
  type RpcLog,
  hexToBigInt,
  isHex,
} from "viem";
import { startClock } from "./timer.js";
import { wait } from "./wait.js";

type RequestReturnType<
  method extends EIP1193Parameters<PublicRpcSchema>["method"],
> = Extract<PublicRpcSchema[number], { Method: method }>["ReturnType"];

type Options = {
  shouldRetryInvalidInput: boolean;
};

export type RequestQueue = Omit<
  Queue<
    RequestReturnType<EIP1193Parameters<PublicRpcSchema>["method"]>,
    EIP1193Parameters<PublicRpcSchema>
  >,
  "add"
> & {
  request: <TParameters extends EIP1193Parameters<PublicRpcSchema>>(
    parameters: TParameters,
    options?: Partial<Options>,
  ) => Promise<RequestReturnType<TParameters["method"]>>;
};

const RETRY_COUNT = 9;
const BASE_DURATION = 125;

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
  const fetchRequest = async (
    request: EIP1193Parameters<PublicRpcSchema>,
    options: Partial<Options>,
  ) => {
    for (let i = 0; i <= RETRY_COUNT; i++) {
      try {
        const stopClock = startClock();
        const response = await network.transport.request(request);
        common.metrics.ponder_rpc_request_duration.observe(
          { method: request.method, network: network.name },
          stopClock(),
        );

        return response;
      } catch (_error) {
        const error = _error as Error;

        if (
          request.method === "eth_getLogs" &&
          isHex(request.params[0].fromBlock) &&
          isHex(request.params[0].toBlock)
        ) {
          const getLogsErrorResponse = getLogsRetryHelper({
            params: request.params as GetLogsRetryHelperParameters["params"],
            error: error as RpcError,
          });

          if (getLogsErrorResponse.shouldRetry === false) throw error;

          common.logger.debug({
            service: "sync",
            msg: `Caught eth_getLogs error on '${
              network.name
            }', retrying with ranges: [${getLogsErrorResponse.ranges
              .map(
                ({ fromBlock, toBlock }) =>
                  `[${hexToBigInt(fromBlock).toString()}, ${hexToBigInt(
                    toBlock,
                  ).toString()}]`,
              )
              .join(", ")}].`,
          });

          const logs: RpcLog[] = [];
          for (const { fromBlock, toBlock } of getLogsErrorResponse.ranges) {
            const _logs = await fetchRequest(
              {
                method: "eth_getLogs",
                params: [
                  {
                    topics: request.params![0].topics,
                    address: request.params![0].address,
                    fromBlock,
                    toBlock,
                  },
                ],
              },
              options,
            );

            logs.push(...(_logs as RpcLog[]));
          }

          return logs;
        }

        if (shouldRetry(error, options) === false) {
          common.logger.warn({
            service: "sync",
            msg: `Failed '${request.method}' RPC request with non-retryable error: ${error.message}`,
          });
          throw error;
        }

        if (i === RETRY_COUNT) {
          common.logger.warn({
            service: "sync",
            msg: `Failed '${request.method}' RPC request after ${
              i + 1
            } attempts with error: ${error.message}`,
          });
          throw error;
        }

        const duration = BASE_DURATION * 2 ** i;
        common.logger.debug({
          service: "sync",
          msg: `Failed '${request.method}' RPC request, retrying after ${duration} milliseconds. Error: ${error.message}`,
        });
        await wait(duration);
      }
    }
  };

  const requestQueue: Queue<
    unknown,
    {
      request: EIP1193Parameters<PublicRpcSchema>;
      options?: Partial<Options>;
      stopClockLag: () => number;
    }
  > = createQueue({
    frequency: network.maxRequestsPerSecond,
    concurrency: Math.ceil(network.maxRequestsPerSecond / 4),
    initialStart: true,
    browser: false,
    worker: async ({
      request,
      options = { shouldRetryInvalidInput: true },
      stopClockLag,
    }: {
      request: EIP1193Parameters<PublicRpcSchema>;
      options?: Partial<Options>;
      stopClockLag: () => number;
    }) => {
      common.metrics.ponder_rpc_request_lag.observe(
        { method: request.method, network: network.name },
        stopClockLag(),
      );

      return await fetchRequest(request, options);
    },
  });

  return {
    ...requestQueue,
    request: <TParameters extends EIP1193Parameters<PublicRpcSchema>>(
      params: TParameters,
      options?: Partial<Options>,
    ) => {
      const stopClockLag = startClock();

      return requestQueue.add({ request: params, options, stopClockLag });
    },
  } as RequestQueue;
};

/**
 * @link https://github.com/wevm/viem/blob/main/src/utils/buildRequest.ts#L192
 */
function shouldRetry(error: Error, options: Partial<Options>) {
  if ("code" in error && typeof error.code === "number") {
    if (error.code === -1) return true; // Unknown error
    if (
      options.shouldRetryInvalidInput &&
      error.code === InvalidInputRpcError.code
    )
      return true;
    if (error.code === LimitExceededRpcError.code) return true;
    if (error.code === InternalRpcError.code) return true;
    return false;
  }
  if (error instanceof BlockNotFoundError) return true;
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
