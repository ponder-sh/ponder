import { setupAnvil, setupCleanup, setupCommon } from "@/_test/setup.js";
import { getNetwork } from "@/_test/utils.js";
import { beforeEach, expect, test } from "vitest";
import { createRequestQueue } from "./requestQueue.js";

beforeEach(setupCommon);
beforeEach(setupAnvil);
beforeEach(setupCleanup);

test("requests", async ({ common }) => {
  const network = getNetwork();

  const { request } = createRequestQueue({
    network: { ...network, maxRequestsPerSecond: 1 },
    common,
  });

  const chainId = await request({ method: "eth_chainId" });

  expect(chainId).toBe("0x1");
});
