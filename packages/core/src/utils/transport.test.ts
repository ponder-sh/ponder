import { expect, test } from "vitest";
import { createRequestQueue } from "./transport.js";
import { wait } from "./wait.js";

/**
 * Returns a callback and an async function that resolves when the callback is invoked.
 */
const createAsyncResolver = <T>(x: T) => {
  let resolve: () => void;
  const promise = new Promise<T>((res) => {
    resolve = () => res(x);
  });
  return { resolve: resolve!, promiseFn: () => promise };
};

test("size and pending", async () => {
  const queue = createRequestQueue(1);

  const r1 = createAsyncResolver(undefined);
  const r2 = createAsyncResolver(undefined);

  queue.add(r1.promiseFn);
  queue.add(r2.promiseFn);

  expect(await queue.size()).toBe(1);
  expect(await queue.pending()).toBe(1);

  r1.resolve();

  expect(await queue.size()).toBe(1);
});

test("request per second", async () => {
  const queue = createRequestQueue(1);

  const r1 = createAsyncResolver(undefined);
  const r2 = createAsyncResolver(undefined);

  queue.add(r1.promiseFn);
  queue.add(r2.promiseFn);

  expect(await queue.size()).toBe(1);
  expect(await queue.pending()).toBe(1);

  r1.resolve();

  expect(await queue.size()).toBe(1);
  expect(await queue.pending()).toBe(0);

  await wait(1000);

  expect(await queue.size()).toBe(0);
  expect(await queue.pending()).toBe(1);

  r2.resolve();

  expect(await queue.size()).toBe(0);
  expect(await queue.pending()).toBe(0);
});

test("add() returns promise", async () => {
  const queue = createRequestQueue(1);

  const r1 = createAsyncResolver(1);
  const promise = queue.add(r1.promiseFn);

  r1.resolve();

  expect(await promise).toBe(1);
});
