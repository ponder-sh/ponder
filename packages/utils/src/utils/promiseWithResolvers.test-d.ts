import { expectTypeOf, test } from "bun:test";
import { promiseWithResolvers } from "./promiseWithResolvers.js";

test("resolve type", () => {
  const { resolve } = promiseWithResolvers<number>();
  expectTypeOf(resolve).toExtend<(arg: number) => void>();
});

test("promise type", () => {
  const { promise } = promiseWithResolvers<number>();
  expectTypeOf(promise).toExtend<Promise<number>>();
});
