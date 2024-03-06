import type { Network } from "@/config/networks.js";
import type { MetricsService } from "@/metrics/service.js";
import { type Queue, createQueue } from "@ponder/common";
import { type EIP1193Parameters, type PublicRpcSchema } from "viem";
import { startClock } from "./timer.js";

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
  metrics,
}: { network: Network; metrics: MetricsService }): RequestQueue => {
  const requestQueue = createQueue({
    frequency: network.maxRequestsPerSecond,
    concurrency: Math.ceil(network.maxRequestsPerSecond / 4),
    initialStart: true,
    worker: (task: {
      request: EIP1193Parameters<PublicRpcSchema>;
      stopClockLag: () => number;
    }) => {
      metrics.ponder_rpc_request_lag.observe(
        { method: task.request.method, network: network.name },
        task.stopClockLag(),
      );

      const stopClock = startClock();

      return network.transport.request(task.request).finally(() => {
        metrics.ponder_rpc_request_duration.observe(
          { method: task.request.method, network: network.name },
          stopClock(),
        );
      });
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
