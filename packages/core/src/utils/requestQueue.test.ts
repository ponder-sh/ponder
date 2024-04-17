import { setupAnvil, setupContext } from "@/_test/setup.js";
import type { Common } from "@/common/common.js";
import type { Network } from "@/config/networks.js";
import { beforeEach, expect, test } from "vitest";
import { createRequestQueue } from "./requestQueue.js";

beforeEach(setupContext);
beforeEach(setupAnvil);

/** Creates a request queue with a `maxRequestsPerSecond` of 1. */
const getQueue = (network: Network, common: Common) => {
  return createRequestQueue({
    network: { ...network, maxRequestsPerSecond: 1 },
    metrics: common.metrics,
  });
};

test("requests", async ({ networks, common }) => {
  const queue = getQueue(networks[0], common);
  queue.start();

  const chainId = await queue.request({ method: "eth_chainId" });

  expect(chainId).toBe("0x1");
});
