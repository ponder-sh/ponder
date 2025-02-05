import { promiseWithResolvers } from "@ponder/common";
import { expect, test, vi } from "vitest";
import { mutex } from "./mutex.js";

test("mutex", async () => {
  const promiseWithResolvers1 = promiseWithResolvers<void>();
  const promiseWithResolvers2 = promiseWithResolvers<void>();

  const spy = vi.fn((promise: Promise<void>) => promise);

  const fn = mutex(spy);

  const promise1 = fn(promiseWithResolvers1.promise);
  const promise2 = fn(promiseWithResolvers2.promise);

  expect(spy).toHaveBeenCalledTimes(1);

  promiseWithResolvers1.resolve();

  await new Promise(setImmediate);

  expect(spy).toHaveBeenCalledTimes(2);

  promiseWithResolvers2.resolve();

  await promise1;
  await promise2;
});
