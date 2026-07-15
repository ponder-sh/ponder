import { beforeEach, expect, test } from "vitest";
import { context, setupCommon } from "@/_test/setup.js";
import { getNextAvailablePort } from "./port.js";

beforeEach(setupCommon);

test("port", async () => {
  const port = await getNextAvailablePort({ common: context.common });
  expect(port).toBe(42069);
});
