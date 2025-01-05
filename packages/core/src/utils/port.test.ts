import { setupCommon } from "@/_test/setup.js";
import { beforeEach, expect, test } from "vitest";
import { getNextAvailablePort } from "./port.js";

beforeEach(setupCommon);

test("port", async (context) => {
  const port = await getNextAvailablePort({ common: context.common });
  expect(port).toBe(42069);
});
