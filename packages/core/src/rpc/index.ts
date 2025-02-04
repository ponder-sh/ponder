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
  type WebSocketTransport,
  webSocket,
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
  let httpIndex = 0;
  let wsIndex = 0;
  const httpTransports: ReturnType<HttpTransport>[] = [];
  const wsTransports: ReturnType<WebSocketTransport>[] = [];

  if (typeof chain.rpcUrl === "string") {
    if (
      new URL(chain.rpcUrl).protocol === "http" ||
      new URL(chain.rpcUrl).protocol === "https"
    ) {
      httpTransports.push(http(chain.rpcUrl)({ chain: chain.chain }));
    } else if (
      new URL(chain.rpcUrl).protocol === "ws" ||
      new URL(chain.rpcUrl).protocol === "wss"
    ) {
      wsTransports.push(webSocket(chain.rpcUrl)({ chain: chain.chain }));
    }
  } else if (Array.isArray(chain.rpcUrl)) {
    for (const url of chain.rpcUrl) {
      if (
        new URL(url).protocol === "http:" ||
        new URL(url).protocol === "https:"
      ) {
        httpTransports.push(http(url)({ chain: chain.chain }));
      } else if (
        new URL(url).protocol === "ws:" ||
        new URL(url).protocol === "wss:"
      ) {
        wsTransports.push(webSocket(url)({ chain: chain.chain }));
      }
    }
  }

  const requestQueue = createQueue<
    Awaited<ReturnType<RPC["request"]>>,
    Parameters<RPC["request"]>[0]
  >({
    frequency: chain.maxRequestsPerSecond,
    concurrency: Math.ceil(chain.maxRequestsPerSecond / 4),
    initialStart: true,
    browser: false,
    // @ts-ignore
    worker: async (request) => {
      for (let i = 0; i <= RETRY_COUNT; i++) {
        try {
          const stopClock = startClock();
          common.logger.trace({
            service: "rpc",
            msg: `Sent ${request.method} request (params=${JSON.stringify(request.params)})`,
          });

          const responsePromise = httpTransports[httpIndex++]!.request(request);
          if (httpIndex === httpTransports.length) httpIndex = 0;
          const response = await responsePromise;

          common.logger.trace({
            service: "rpc",
            msg: `Received ${request.method} response (duration=${stopClock()}, params=${JSON.stringify(request.params)})`,
          });
          common.metrics.ponder_rpc_request_duration.observe(
            { method: request.method, network: chain.chain.name },
            stopClock(),
          );

          return response as RequestReturnType<typeof request.method>;
        } catch (_error) {
          const error = _error as Error;

          // TODO(kyle) log ranges

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
    },
  });

  return {
    // @ts-ignore
    request: requestQueue.add,
    // @ts-ignore
    subscribe: async (request) => {
      for (let i = 0; i <= RETRY_COUNT; i++) {
        try {
          const stopClock = startClock();
          common.logger.trace({
            service: "rpc",
            msg: `Sent eth_subscribe request (params=${JSON.stringify(request.params)})`,
          });

          const responsePromise =
            wsTransports[wsIndex++]!.value!.subscribe(request);
          if (wsIndex === wsTransports.length) wsIndex = 0;
          const response = await responsePromise;

          common.logger.trace({
            service: "rpc",
            msg: `Received eth_subscribe response (duration=${stopClock()}, params=${JSON.stringify(request.params)})`,
          });
          common.metrics.ponder_rpc_request_duration.observe(
            { method: "eth_subscribe", network: chain.chain.name },
            stopClock(),
          );

          return response;
        } catch (_error) {
          const error = _error as Error;

          if (shouldRetry(error) === false) {
            common.logger.warn({
              service: "rpc",
              msg: "Failed eth_subscribe request",
            });
            throw error;
          }

          if (i === RETRY_COUNT) {
            common.logger.warn({
              service: "rpc",
              msg: `Failed eth_subscribe request after ${i + 1} attempts`,
              error,
            });
            throw error;
          }

          const duration = BASE_DURATION * 2 ** i;
          common.logger.debug({
            service: "rpc",
            msg: `Failed eth_subscribe request, retrying after ${duration} milliseconds`,
            error,
          });
          await wait(duration);
        }
      }
    },
    supports: (method) => {
      if (method === "eth_subscribe" && wsTransports.length === 0) return false;
      return true;
    },
  };
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
