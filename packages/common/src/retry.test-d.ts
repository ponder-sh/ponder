import { assertType, test } from "vitest";
import { retry } from "./retry.js";

test("returnType", () => {
  const callback = () => Promise.resolve(1 as const);
  const out = retry(callback);
  assertType<Promise<1>>(out.promise);
});
