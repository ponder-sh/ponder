import type { Common } from "@/common/common.js";
import { NonRetryableError } from "@/common/errors.js";
import type { Network } from "@/config/networks.js";
import { type Queue, createQueue } from "@ponder/common";
import {
  type GetLogsRetryHelperParameters,
  getLogsRetryHelper,
} from "@ponder/utils";
import {
  BlockNotFoundError,
  type EIP1193Parameters,
  type FallbackTransport,
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
import { startClock } from "../utils/timer.js";
import { wait } from "../utils/wait.js";

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
  subscribe: (params: SubscribeParameters) => Promise<SubscribeReturnType>;
};

type ResolvedWebSocketTransport = Omit<
  ReturnType<WebSocketTransport>,
  "value"
> & {
  value: NonNullable<ReturnType<WebSocketTransport>["value"]>;
};

export type SubscribeParameters = Parameters<
  ResolvedWebSocketTransport["value"]["subscribe"]
>[0] & {
  method: "eth_subscribe";
};

export type SubscribeReturnType = Awaited<
  ReturnType<ResolvedWebSocketTransport["value"]["subscribe"]>
>;

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
  const withRetry = async <
    T extends EIP1193Parameters<PublicRpcSchema> | SubscribeParameters,
  >({
    fn,
    request,
  }: {
    fn: (request: T) => Promise<unknown>;
    request: T;
  }) => {
    for (let i = 0; i <= RETRY_COUNT; i++) {
      try {
        return await fn(request);
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

        if (
          error instanceof NonRetryableError ||
          shouldRetry(error) === false
        ) {
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
    throw "unreachable";
  };

  const fetchRequest = async (request: EIP1193Parameters<PublicRpcSchema>) => {
    const stopClock = startClock();
    const response = await network.transport.request(request);
    common.metrics.ponder_rpc_request_duration.observe(
      { method: request.method, network: network.name },
      stopClock(),
    );

    return response;
  };

  const subscribe = async (request: SubscribeParameters) => {
    const stopClock = startClock();

    const wsTransport = resolveWebsocketTransport(network.transport);

    if (wsTransport === undefined) {
      throw new NonRetryableError(
        `No webSocket transport found for ${network.transport.config.type} transport.`,
      );
    }

    const { method, ...req } = request;

    const response = await wsTransport.value.subscribe(req);

    common.metrics.ponder_rpc_request_duration.observe(
      { method: method, network: network.name },
      stopClock(),
    );

    return response;
  };

  const requestQueue: Queue<
    unknown,
    {
      request: EIP1193Parameters<PublicRpcSchema> | SubscribeParameters;
      stopClockLag: () => number;
    }
  > = createQueue({
    frequency: network.maxRequestsPerSecond,
    concurrency: Math.ceil(network.maxRequestsPerSecond / 4),
    initialStart: true,
    browser: false,
    worker: async (task: {
      request: EIP1193Parameters<PublicRpcSchema> | SubscribeParameters;
      stopClockLag: () => number;
    }) => {
      common.metrics.ponder_rpc_request_lag.observe(
        { method: task.request.method, network: network.name },
        task.stopClockLag(),
      );

      if (task.request.method === "eth_subscribe") {
        return await withRetry({
          fn: subscribe,
          request: task.request,
        });
      } else {
        return await withRetry({
          fn: fetchRequest,
          request: task.request,
        });
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
    subscribe: (params: SubscribeParameters) => {
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

export function resolveWebsocketTransport(
  transport: ReturnType<Transport>,
): ResolvedWebSocketTransport | undefined {
  if (transport.config.type === "http") {
    return undefined;
  }

  if (transport.config.type === "fallback") {
    const fallbackTransport: ReturnType<FallbackTransport> =
      transport as ReturnType<FallbackTransport>;

    const wsTransport = fallbackTransport.value!.transports.find(
      (t: ReturnType<Transport>) => t.config.type === "webSocket",
    ) as ResolvedWebSocketTransport | undefined;

    return wsTransport;
  }

  if (transport.config.type === "webSocket") {
    return transport as ResolvedWebSocketTransport;
  }

  return undefined;
}
