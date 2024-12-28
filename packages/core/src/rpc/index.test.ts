import { setupAnvil, setupCommon } from "@/_test/setup.js";
import { getNetwork } from "@/_test/utils.js";
import { beforeEach, expect, test } from "vitest";
import { createRpc } from "./index.js";

beforeEach(setupCommon);
beforeEach(setupAnvil);

test("requests", async ({ common }) => {
  const network = getNetwork();
  network.maxRequestsPerSecond = 1;

  const rpc = createRpc({ common, network });

  const chainId = await rpc.request({ method: "eth_chainId" });

  expect(chainId).toBe("0x1");
});
