import { RpcRequestError } from "viem";

import type { Network } from "@/config/networks.js";

import { TASK_TIMEOUT } from "./queue.js";

export const getErrorMessage = (error: Error) =>
  error.name === "TimeoutError"
    ? `Timed out after ${TASK_TIMEOUT} ms`
    : `${error.name}: ${error.message}`;

export const request = async (
  network: Pick<Network, "url" | "request">,
  options: Parameters<Network["request"]>[0],
): Promise<any> => {
  const rawRequest = await network.request(options);

  if (rawRequest.error)
    throw new RpcRequestError({
      body: options.body,
      error: rawRequest.error,
      url: network.url,
    });

  return rawRequest.result;
};
