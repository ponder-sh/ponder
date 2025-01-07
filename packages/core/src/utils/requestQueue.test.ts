import { setupAnvil, setupCommon } from "@/_test/setup.js";
import { getChain } from "@/_test/utils.js";
import type { Common } from "@/internal/common.js";
import type { Network } from "@/internal/types.js";
import { beforeEach, expect, test } from "vitest";
import { createRequestQueue } from "./requestQueue.js";

beforeEach(setupCommon);
beforeEach(setupAnvil);

/** Creates a request queue with a `maxRequestsPerSecond` of 1. */
const getQueue = (network: Network, common: Common) => {
  return createRequestQueue({
    network: { ...network, maxRequestsPerSecond: 1 },
    common,
  });
};

test("requests", async ({ common }) => {
  const network = getChain();

  const queue = getQueue(network, common);
  queue.start();

  const chainId = await queue.request({ method: "eth_chainId" });

  expect(chainId).toBe("0x1");
});
