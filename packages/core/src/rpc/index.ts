import type { Common } from "@/internal/common.js";
import type { Chain } from "@/internal/types.js";
import { startClock } from "@/utils/timer.js";
import { wait } from "@/utils/wait.js";
import { createQueue } from "@ponder/common";
import {
  http,
  type EIP1193Parameters,
  HttpRequestError,
  type HttpTransport,
  JsonRpcVersionUnsupportedError,
  MethodNotFoundRpcError,
  MethodNotSupportedRpcError,
  ParseRpcError,
  type PublicRpcSchema,
} from "viem";
import type { DebugRpcSchema } from "../utils/debug.js";

type Schema = [...PublicRpcSchema, ...DebugRpcSchema];

type RequestReturnType<method extends EIP1193Parameters<Schema>["method"]> =
  Extract<Schema[number], { Method: method }>["ReturnType"];

export type RPC = {
  request: <TParameters extends EIP1193Parameters<Schema>>(
    parameters: TParameters,
  ) => Promise<RequestReturnType<TParameters["method"]>>;
};

const RETRY_COUNT = 9;
const BASE_DURATION = 125;

export const createRpc = ({
  common,
  chain,
}: { common: Common; chain: Chain }): RPC => {};

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
