import { setupAnvil, setupCommon } from "@/_test/setup.js";
import { beforeEach, expect, test } from "vitest";
import { createRpc } from "./index.js";

beforeEach(setupCommon);
beforeEach(setupAnvil);

test("requests", async ({ networks, common }) => {
  networks[0].maxRequestsPerSecond = 1;

  const rpc = createRpc({ common, network: networks[0] });

  const chainId = await rpc.request({ method: "eth_chainId" });

  expect(chainId).toBe("0x1");
});
