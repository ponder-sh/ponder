import { promiseWithResolvers } from "@ponder/common";
import { test } from "vitest";
import { mutex } from "./mutex.js";

test("mutex", async () => {
  const promiseWithResolvers1 = promiseWithResolvers<number>();
  const promiseWithResolvers2 = promiseWithResolvers<number>();

  const fn = mutex((promise: Promise<number>) => promise);

  const promise1 = fn(promiseWithResolvers1.promise);
  const promise2 = fn(promiseWithResolvers2.promise);

  promiseWithResolvers1.resolve(1);
  promiseWithResolvers2.resolve(2);

  await promise1;
  await promise2;
});
