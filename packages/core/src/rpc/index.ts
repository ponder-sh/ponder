import type { Common } from "@/internal/common.js";
import type { Chain } from "@/internal/types.js";
import {
  BlockNotFoundError,
  type EIP1193Parameters,
  HttpRequestError,
  InternalRpcError,
  InvalidInputRpcError,
  LimitExceededRpcError,
  type PublicRpcSchema,
  type WebSocketTransport,
} from "viem";
import type { DebugRpcSchema } from "../utils/debug.js";

type Schema = [...PublicRpcSchema, ...DebugRpcSchema];

type RequestReturnType<method extends EIP1193Parameters<Schema>["method"]> =
  Extract<Schema[number], { Method: method }>["ReturnType"];

type SubscribeParameters = Parameters<
  NonNullable<ReturnType<WebSocketTransport>["value"]>["subscribe"]
>[0];

type SubscribeReturnType = Awaited<
  ReturnType<NonNullable<ReturnType<WebSocketTransport>["value"]>["subscribe"]>
>;

export type RPC = {
  request: <TParameters extends EIP1193Parameters<Schema>>(
    parameters: TParameters,
  ) => Promise<RequestReturnType<TParameters["method"]>>;
  subscribe: (params: SubscribeParameters) => Promise<SubscribeReturnType>;
  supports: (
    method: EIP1193Parameters<Schema>["method"] | "eth_subscribe",
  ) => boolean;
};

const RETRY_COUNT = 9;
const BASE_DURATION = 125;

export const createRpc = ({
  common,
  chain,
}: {
  common: Common;
  chain: Omit<Chain, "rpc">;
}): RPC => {
  // @ts-ignore
  // const fetchRequest = async (request: EIP1193Parameters<PublicRpcSchema>) => {
  //   for (let i = 0; i <= RETRY_COUNT; i++) {
  //     try {
  //       const stopClock = startClock();
  //       common.logger.trace({
  //         service: "rpc",
  //         msg: `Sent ${request.method} request (params=${JSON.stringify(request.params)})`,
  //       });
  //       const response = await network.transport.request(request);
  //       common.logger.trace({
  //         service: "rpc",
  //         msg: `Received ${request.method} response (duration=${stopClock()}, params=${JSON.stringify(request.params)})`,
  //       });
  //       common.metrics.ponder_rpc_request_duration.observe(
  //         { method: request.method, network: network.name },
  //         stopClock(),
  //       );

  //       return response;
  //     } catch (_error) {
  //       const error = _error as Error;

  //       if (
  //         request.method === "eth_getLogs" &&
  //         isHex(request.params[0].fromBlock) &&
  //         isHex(request.params[0].toBlock)
  //       ) {
  //         const getLogsErrorResponse = getLogsRetryHelper({
  //           params: request.params as GetLogsRetryHelperParameters["params"],
  //           error: error as RpcError,
  //         });

  //         if (getLogsErrorResponse.shouldRetry === true) throw error;
  //       }

  //       if (shouldRetry(error) === false) {
  //         common.logger.warn({
  //           service: "rpc",
  //           msg: `Failed ${request.method} request`,
  //         });
  //         throw error;
  //       }

  //       if (i === RETRY_COUNT) {
  //         common.logger.warn({
  //           service: "rpc",
  //           msg: `Failed ${request.method} request after ${i + 1} attempts`,
  //           error,
  //         });
  //         throw error;
  //       }

  //       const duration = BASE_DURATION * 2 ** i;
  //       common.logger.debug({
  //         service: "rpc",
  //         msg: `Failed ${request.method} request, retrying after ${duration} milliseconds`,
  //         error,
  //       });
  //       await wait(duration);
  //     }
  //   }
  // };

  return {} as RPC;
};

/**
 * @link https://github.com/wevm/viem/blob/main/src/utils/buildRequest.ts#L192
 */
function shouldRetry(error: Error) {
  if ("code" in error && typeof error.code === "number") {
    if (error.code === -1) return true; // Unknown error
    if (error.code === InvalidInputRpcError.code) return true;
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
