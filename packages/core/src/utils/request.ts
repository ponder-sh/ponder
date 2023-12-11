import { RpcRequestError } from "viem";

import type { Network } from "@/config/networks.js";

import { TASK_RETRY_TIMEOUT, TASK_TIMEOUT } from "./queue.js";
import { wait } from "./wait.js";

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

export const requestWithRetry = async (request: () => Promise<any>) => {
  for (let i = 0; i <= TASK_RETRY_TIMEOUT.length; i++) {
    if (i > 0) await wait(TASK_RETRY_TIMEOUT[i - 1]);
    try {
      return await request();
    } catch (err) {
      if (i === TASK_RETRY_TIMEOUT.length) throw err;
    }
  }
};
