import type { Network } from "@/config/networks.js";
import type { MetricsService } from "@/metrics/service.js";
import { type Queue, createFrequencyQueue } from "@ponder/utils";
import { type EIP1193Parameters, type PublicRpcSchema } from "viem";

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
}: { network: Network; metrics: MetricsService }): RequestQueue => {
  const requestQueue = createFrequencyQueue({
    frequency: network.maxRequestsPerSecond,
    worker: (task: EIP1193Parameters<PublicRpcSchema>) => {
      return network.transport.request(task);
    },
  });

  requestQueue.start();

  return {
    ...requestQueue,
    request: <TParameters extends EIP1193Parameters<PublicRpcSchema>>(
      params: TParameters,
    ) => {
      return requestQueue.add(params);
    },
  } as RequestQueue;
};
