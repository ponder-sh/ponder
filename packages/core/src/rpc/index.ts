import type { Common } from "@/internal/common.js";
import type { Chain } from "@/internal/types.js";
import { createQueue } from "@/utils/queue.js";
import { startClock } from "@/utils/timer.js";
import { wait } from "@/utils/wait.js";
import {
  http,
  type EIP1193Parameters,
  HttpRequestError,
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

export type Rpc = {
  request: <TParameters extends EIP1193Parameters<Schema>>(
    parameters: TParameters,
  ) => Promise<RequestReturnType<TParameters["method"]>>;
};

const RETRY_COUNT = 9;
const BASE_DURATION = 125;

export const createRpc = ({
  common,
  chain,
}: { common: Common; chain: Chain }): Rpc => {
  const request = http(chain.rpcUrl)({
    chain: chain.chain,
    retryCount: 0,
    timeout: 5_000,
  }).request;

  const queue = createQueue<
    Awaited<ReturnType<Rpc["request"]>>,
    Parameters<Rpc["request"]>[0]
  >({
    frequency: chain.maxRequestsPerSecond,
    initialStart: true,
    // TODO(kyle) concurrency,
    // @ts-ignore
    worker: async (task) => {
      for (let i = 0; i <= RETRY_COUNT; i++) {
        try {
          const stopClock = startClock();
          common.logger.trace({
            service: "rpc",
            msg: `Sent ${task.method} request (params=${JSON.stringify(task.params)})`,
          });

          const response = await request(task);
          // TODO(kyle) can response be undefined

          common.logger.trace({
            service: "rpc",
            msg: `Received ${task.method} response (duration=${stopClock()}, params=${JSON.stringify(task.params)})`,
          });
          common.metrics.ponder_rpc_request_duration.observe(
            { method: task.method, chain: chain.chain.name },
            stopClock(),
          );

          return response as RequestReturnType<typeof task.method>;
        } catch (e) {
          const error = e as Error;

          // TODO(kyle) log ranges

          if (shouldRetry(error) === false) {
            common.logger.warn({
              service: "rpc",
              msg: `Failed ${task.method} request`,
            });
            throw error;
          }

          if (i === RETRY_COUNT) {
            common.logger.warn({
              service: "rpc",
              msg: `Failed ${task.method} request after ${i + 1} attempts`,
              error,
            });
            throw error;
          }

          const duration = BASE_DURATION * 2 ** i;
          common.logger.debug({
            service: "rpc",
            msg: `Failed ${task.method} request, retrying after ${duration} milliseconds`,
            error,
          });
          await wait(duration);
        }
      }
    },
  });

  return {
    // @ts-ignore
    request: queue.add,
  };
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
