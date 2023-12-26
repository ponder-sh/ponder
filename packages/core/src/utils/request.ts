import type { Network } from "@/config/networks.js";
import type { EIP1193Parameters, PublicRpcSchema } from "viem";
import { TASK_TIMEOUT } from "./queue.js";
import { createRequestQueue } from "./requestQueue.js";

// TODO:Kyle Don't need this anymore
export const getErrorMessage = (error: Error) =>
  error.name === "TimeoutError"
    ? `Timed out after ${TASK_TIMEOUT} ms`
    : `${error.name}: ${error.message}`;

const requestQueue = createRequestQueue(5);

export type RequestReturnType<
  method extends EIP1193Parameters<PublicRpcSchema>["method"],
> = Promise<Extract<PublicRpcSchema[number], { Method: method }>["ReturnType"]>;

export const request = <
  TParameters extends EIP1193Parameters<PublicRpcSchema>,
  TType extends "realtime" | "historical",
>(
  network: Network,
  type: TType,
  params: TParameters,
  blockNumber?: TType extends "historical" ? number : never,
): RequestReturnType<TParameters["method"]> =>
  requestQueue.add(type, () => network.transport.request(params), blockNumber);
