import type { Network } from "@/config/networks.js";
import type { EIP1193Parameters, PublicRpcSchema } from "viem";
import { TASK_TIMEOUT } from "./queue.js";
import { createRequestQueue } from "./requestQueue.js";

export const getErrorMessage = (error: Error) =>
  error.name === "TimeoutError"
    ? `Timed out after ${TASK_TIMEOUT} ms`
    : `${error.name}: ${error.message}`;

const requestQueue = createRequestQueue(5);

export type RequestReturnType<
  method extends EIP1193Parameters<PublicRpcSchema>["method"],
> = Promise<Extract<PublicRpcSchema[number], { Method: method }>["ReturnType"]>;

export const request = <TParameters extends EIP1193Parameters<PublicRpcSchema>>(
  network: Network,
  type: "realtime" | "historical",
  params: TParameters,
): RequestReturnType<TParameters["method"]> =>
  requestQueue.add(() => network.transport.request(params), type);
