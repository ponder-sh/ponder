import url from "node:url";
import type { Common } from "@/internal/common.js";
import type { Chain, SyncBlock } from "@/internal/types.js";
import type { RealtimeSync } from "@/sync-realtime/index.js";
import { createQueue } from "@/utils/queue.js";
import { _eth_getBlockByNumber } from "@/utils/rpc.js";
import { startClock } from "@/utils/timer.js";
import { wait } from "@/utils/wait.js";
import {
  type GetLogsRetryHelperParameters,
  getLogsRetryHelper,
  loadBalance,
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

export const createRpc = ({
  common,
  chain,
  concurrency = 25,
}: { common: Common; chain: Chain; concurrency?: number }): Rpc => {
  let request: EIP1193RequestFn;
  if (typeof chain.rpc === "string") {
    const protocol = new url.URL(chain.rpc).protocol;
    if (protocol === "https:" || protocol === "http:") {
      request = http(chain.rpc)({
        chain: chain.viemChain,
        retryCount: 0,
        timeout: 5_000,
      }).request;
    } else if (protocol === "wss:" || protocol === "ws:") {
      request = webSocket(chain.rpc)({
        chain: chain.viemChain,
        retryCount: 0,
        timeout: 5_000,
      }).request;
    } else {
      throw new Error(`Unsupported RPC URL protocol: ${protocol}`);
    }
  } else if (Array.isArray(chain.rpc)) {
    request = loadBalance(
      chain.rpc.map((rpc) => {
        const protocol = new url.URL(rpc).protocol;
        if (protocol === "https:" || protocol === "http:") {
          return http(rpc);
        } else if (protocol === "wss:" || protocol === "ws:") {
          return webSocket(rpc);
        } else {
          throw new Error(`Unsupported RPC URL protocol: ${protocol}`);
        }
      }),
    )({
      chain: chain.viemChain,
      retryCount: 0,
      timeout: 5_000,
    }).request;
  } else {
    request = chain.rpc({
      chain: chain.viemChain,
      retryCount: 0,
      timeout: 5_000,
    }).request;
  }

  const queue = createQueue<
    Awaited<ReturnType<Rpc["request"]>>,
    Parameters<Rpc["request"]>[0]
  >({
    initialStart: true,
    frequency: chain.maxRequestsPerSecond,
    concurrency,
    // @ts-ignore
    worker: async (body) => {
      for (let i = 0; i <= RETRY_COUNT; i++) {
        try {
          const stopClock = startClock();
          common.logger.trace({
            service: "rpc",
            msg: `Sent ${body.method} request (params=${JSON.stringify(body.params)})`,
          });

          const response = await request(body);
          // TODO(kyle) can response be undefined

          common.logger.trace({
            service: "rpc",
            msg: `Received ${body.method} response (duration=${stopClock()}, params=${JSON.stringify(body.params)})`,
          });
          common.metrics.ponder_rpc_request_duration.observe(
            { method: body.method, chain: chain.name },
            stopClock(),
          );

          return response as RequestReturnType<typeof body.method>;
        } catch (e) {
          const error = e as Error;

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
        }
      }
    },
  });

  let interval: NodeJS.Timeout | undefined;

  const rpc: Rpc = {
    // @ts-ignore
    request: queue.add,
    subscribe({ onBlock, onError }) {
      interval = setInterval(() => {
        _eth_getBlockByNumber(rpc, { blockTag: "latest" })
          .then(onBlock)
          .catch(onError);
      }, chain.pollingInterval);

      common.shutdown.add(() => {
        clearInterval(interval);
      });
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
