import { expect, test } from "vitest";
import { createRequestQueue } from "./requestQueue.js";
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

test("start", async () => {
  const queue = createRequestQueue(1);

  const r1 = createAsyncResolver(undefined);

  queue.add("realtime", r1.promiseFn);

  r1.resolve();

  expect(await queue.size()).toBe(0);
  expect(await queue.pending()).toBe(0);
});

test("size and pending", async () => {
  const queue = createRequestQueue(1);

  const r1 = createAsyncResolver(undefined);
  const r2 = createAsyncResolver(undefined);

  queue.add("realtime", r1.promiseFn);
  queue.add("realtime", r2.promiseFn);

  expect(await queue.size()).toBe(1);
  expect(await queue.pending()).toBe(1);

  r1.resolve();

  expect(await queue.size()).toBe(1);
});

test("request per second", async () => {
  const queue = createRequestQueue(1);

  const r1 = createAsyncResolver(undefined);
  const r2 = createAsyncResolver(undefined);

  queue.add("realtime", r1.promiseFn);
  queue.add("realtime", r2.promiseFn);

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
  const promise = queue.add("realtime", r1.promiseFn);

  r1.resolve();

  expect(await promise).toBe(1);
});

test("add() ordering", async () => {
  const queue = createRequestQueue(1);
  queue.pause();

  const r1 = createAsyncResolver(1);
  const r2 = createAsyncResolver(2);

  queue.add("historical", r1.promiseFn);
  const promise2 = queue.add("realtime", r2.promiseFn);

  queue.start();

  r1.resolve();
  r2.resolve();

  expect(await promise2).toBe(2);
  expect(await queue.size()).toBe(1);
});
