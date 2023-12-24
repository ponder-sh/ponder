import { expect, test } from "vitest";
import { createTransportQueue } from "./transport.js";
import { wait } from "./wait.js";

/**
 * Returns a callback and an async function that resolves when the callback is invoked.
 */
const createAsyncResolver = () => {
  let resolve: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { resolve: resolve!, promiseFn: () => promise };
};

test("queue size and pending", async () => {
  const queue = createTransportQueue(1);

  const r1 = createAsyncResolver();
  const r2 = createAsyncResolver();

  queue.add(r1.promiseFn);
  queue.add(r2.promiseFn);

  expect(await queue.size()).toBe(1);
  expect(await queue.pending()).toBe(1);

  r1.resolve();

  expect(await queue.size()).toBe(1);
});

test("queue request per second", async () => {
  const queue = createTransportQueue(1);

  const r1 = createAsyncResolver();
  const r2 = createAsyncResolver();

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
