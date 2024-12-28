import type { Common } from "@/common/common.js";
import { NonRetryableError } from "@/common/errors.js";
import type { Network } from "@/config/networks.js";
import type { DebugRpcSchema } from "@/utils/debug.js";
import { startClock } from "@/utils/timer.js";
import { wait } from "@/utils/wait.js";
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
  type RpcError,
  type Transport,
  type WebSocketTransport,
  isHex,
} from "viem";

type Schema = [...PublicRpcSchema, ...DebugRpcSchema];

type RequestReturnType<method extends EIP1193Parameters<Schema>["method"]> =
  Extract<Schema[number], { Method: method }>["ReturnType"];

export type SubscribeParameters = Parameters<
  NonNullable<ReturnType<WebSocketTransport>["value"]>["subscribe"]
>[0];

export type SubscribeReturnType = Awaited<
  ReturnType<NonNullable<ReturnType<WebSocketTransport>["value"]>["subscribe"]>
>;

export type Rpc = {
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
  network,
  common,
}: {
  network: Network;
  common: Common;
}): Rpc => {
  // @ts-ignore
  const fetchRequest = async (request: EIP1193Parameters<PublicRpcSchema>) => {
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

          if (getLogsErrorResponse.shouldRetry === true) throw error;
        }

        if (shouldRetry(error) === false) {
          common.logger.warn({
            service: "sync",
            msg: `Failed '${request.method}' RPC request`,
          });
          throw error;
        }

        if (i === RETRY_COUNT) {
          common.logger.warn({
            service: "sync",
            msg: `Failed '${request.method}' RPC request after ${i + 1} attempts`,
            error,
          });
          throw error;
        }

        const duration = BASE_DURATION * 2 ** i;
        common.logger.debug({
          service: "sync",
          msg: `Failed '${request.method}' RPC request, retrying after ${duration} milliseconds`,
          error,
        });
        await wait(duration);
      }
    }
  };

  // @ts-ignore
  const subscribe = async (request: SubscribeParameters) => {
    for (let i = 0; i <= RETRY_COUNT; i++) {
      try {
        const stopClock = startClock();
        const wsTransport = resolveWebsocketTransport(network.transport);

        if (wsTransport?.value === undefined) {
          throw new NonRetryableError(
            `No webSocket transport found for ${network.transport.config.type} transport.`,
          );
        }

        const response = await wsTransport.value.subscribe(request);

        common.metrics.ponder_rpc_request_duration.observe(
          { method: "eth_subscribe", network: network.name },
          stopClock(),
        );
        return response;
      } catch (_error) {
        const error = _error as Error;

        if (i === RETRY_COUNT) {
          common.logger.warn({
            service: "sync",
            msg: `Failed 'eth_subscribe' RPC request after ${i + 1} attempts`,
            error,
          });
          throw error;
        }

        const duration = BASE_DURATION * 2 ** i;
        common.logger.debug({
          service: "sync",
          msg: `Failed 'eth_subscribe' RPC request, retrying after ${duration} milliseconds`,
          error,
        });
        await wait(duration);
      }
    }
  };

  const queue: Queue<
    unknown,
    {
      request: EIP1193Parameters<PublicRpcSchema>;
      stopClockLag: () => number;
    }
  > = createQueue({
    frequency: network.maxRequestsPerSecond,
    concurrency: Math.ceil(network.maxRequestsPerSecond / 4),
    initialStart: true,
    browser: false,
    worker: async ({
      request,
      stopClockLag,
    }: {
      request: EIP1193Parameters<PublicRpcSchema>;
      stopClockLag: () => number;
    }) => {
      common.metrics.ponder_rpc_request_lag.observe(
        { method: request.method, network: network.name },
        stopClockLag(),
      );

      return await fetchRequest(request);
    },
  });

  return {
    request: <TParameters extends EIP1193Parameters<PublicRpcSchema>>(
      params: TParameters,
    ) => {
      const stopClockLag = startClock();

      return queue.add({ request: params, stopClockLag });
    },
    subscribe: async (params: SubscribeParameters) => {
      return await subscribe(params);
    },
    supports: (
      method: EIP1193Parameters<PublicRpcSchema>["method"] | "eth_subscribe",
    ) => {
      if (method === "eth_subscribe") {
        return resolveWebsocketTransport(network.transport) !== undefined;
      }

      return true;
    },
  } as Rpc;
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

function resolveWebsocketTransport(transport: ReturnType<Transport>) {
  if (transport.config.type === "webSocket") {
    return transport as NonNullable<Awaited<ReturnType<WebSocketTransport>>>;
  }

  return undefined;
}
