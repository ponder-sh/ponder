import { assertType, test } from "vitest";
import { promiseWithResolvers } from "./promiseWithResolvers.js";

test("resolve type", () => {
  const { resolve } = promiseWithResolvers<number>();
  assertType<(arg: number) => void>(resolve);
});

test("promise type", () => {
  const { promise } = promiseWithResolvers<number>();
  assertType<Promise<number>>(promise);
});
