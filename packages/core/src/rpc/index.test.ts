import { setupAnvil, setupCommon } from "@/_test/setup.js";
import { getChain } from "@/_test/utils.js";
import { beforeEach, expect, test } from "vitest";
import { createRpc } from "./index.js";
beforeEach(setupCommon);
beforeEach(setupAnvil);

test("requests", async ({ common }) => {
  const chain = getChain();
  const rpc = createRpc({ chain, common });

  const chainId = await rpc.request({ method: "eth_chainId" });

  expect(chainId).toBe("0x1");
});
