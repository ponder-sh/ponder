import { beforeEach, test } from "vitest";

import { setupEthClientErc20 } from "./setup.js";
import { publicClient } from "./utils.js";

beforeEach((context) => setupEthClientErc20(context));

test("test", async () => {
  const block = await publicClient.getBlock();
  console.log(block);
});
