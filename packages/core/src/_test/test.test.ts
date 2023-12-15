import { beforeEach, test } from "vitest";

import { setupEthClient } from "./setup.js";
import { publicClient } from "./utils.js";

beforeEach((context) => setupEthClient(context));

test("test", async () => {
  const block = await publicClient.getBlock();
  console.log(block);
});
