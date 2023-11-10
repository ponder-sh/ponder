import { test } from "vitest";

import { chains } from "./chains.js";

test("test", () => {
  // Will throw on error
  Object.values(chains).map((c) => c.id);
});
