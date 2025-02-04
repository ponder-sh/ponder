import { ShutdownError } from "@/internal/errors.js";
import { createShutdown } from "@/internal/shutdown.js";
import { promiseWithResolvers } from "@ponder/common";
import { expect, test, vi } from "vitest";
import { mutex } from "./mutex.js";

test("mutex", async () => {
  const promiseWithResolvers1 = promiseWithResolvers<void>();
  const promiseWithResolvers2 = promiseWithResolvers<void>();

  const spy = vi.fn((promise: Promise<void>) => promise);

  const fn = mutex(spy, createShutdown());

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

test("mutex shutdown", async () => {
  const promiseWithResolvers1 = promiseWithResolvers<void>();
  const promiseWithResolvers2 = promiseWithResolvers<void>();
  const shutdown = createShutdown();

  const spy = vi.fn((promise: Promise<void>) => promise);

  const fn = mutex(spy, shutdown);

  const promise1 = fn(promiseWithResolvers1.promise).catch((error) => error);
  const promise2 = fn(promiseWithResolvers2.promise).catch((error) => error);

  const shutdownPromise = shutdown.kill();

  expect(await promise2).toBeInstanceOf(ShutdownError);

  promiseWithResolvers1.resolve();

  expect(spy).toHaveBeenCalledTimes(1);

  await promise1;

  await shutdownPromise;
});
