import { setupAnvil, setupCommon } from "@/_test/setup.js";
import { getNetwork } from "@/_test/utils.js";
import type { Common } from "@/common/common.js";
import type { Network } from "@/config/networks.js";
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
  const network = getNetwork();

  const queue = getQueue(network, common);
  queue.start();

  const chainId = await queue.request({ method: "eth_chainId" });

  expect(chainId).toBe("0x1");
});
