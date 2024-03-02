import { assertType, expect, test, vi } from "vitest";
import { createFrequencyQueue } from "./frequencyQueue.js";
import { promiseWithResolvers } from "./promiseWithResolvers.js";

test("add resolves", async () => {
  const queue = createFrequencyQueue({
    frequency: 1,
    worker: () => Promise.resolve(1),
  });

  queue.start();

  const promise = queue.add();

  expect(await promise).toBe(1);
});

test("add rejects", async () => {
  let rejected = false;

  const queue = createFrequencyQueue({
    frequency: 1,
    worker: () => Promise.reject(),
  });

  const promise = queue.add();

  queue.start();

  await promise.catch(() => {
    rejected = true;
  });

  expect(rejected).toBe(true);
});

test("size", () => {
  const queue = createFrequencyQueue({
    frequency: 1,
    worker: () => Promise.resolve(),
  });

  queue.add();

  expect(queue.size()).toBe(1);

  queue.start();

  expect(queue.size()).toBe(0);
});

test("pending", async () => {
  const { promise, resolve } = promiseWithResolvers<void>();

  const queue = createFrequencyQueue({
    frequency: 1,
    worker: () => promise,
  });

  queue.start();

  queue.add();

  expect(await queue.pending()).toBe(1);

  resolve();

  expect(await queue.pending()).toBe(0);
});

test("clear", () => {
  const queue = createFrequencyQueue({
    frequency: 1,
    worker: () => Promise.resolve(),
  });

  queue.add();
  queue.add();
  queue.add();

  queue.clear();

  expect(queue.size()).toBe(0);
});

test("clear timer", async () => {
  const queue = createFrequencyQueue({
    frequency: 1,
    worker: () => Promise.resolve(),
  });

  queue.add();
  queue.add();
  queue.add();

  queue.start();
  queue.clear();

  await queue.onIdle();

  expect(queue.size()).toBe(0);
  expect(await queue.pending()).toBe(0);
});

test("isStarted", () => {
  const queue = createFrequencyQueue({
    frequency: 1,
    worker: () => Promise.resolve(),
  });

  expect(queue.isStarted()).toBe(false);

  queue.start();

  expect(queue.isStarted()).toBe(true);
});

test("start", async () => {
  const queue = createFrequencyQueue({
    frequency: 1,
    worker: () => Promise.resolve(),
  });

  const promise = queue.add();

  expect(queue.size()).toBe(1);

  queue.start();

  expect(queue.isStarted()).toBe(true);

  await promise;

  expect(queue.size()).toBe(0);
});

test("pause", () => {
  const queue = createFrequencyQueue({
    frequency: 1,
    worker: () => Promise.resolve(),
  });

  queue.start();
  queue.pause();

  queue.add();

  expect(queue.size()).toBe(1);
});

test("onIdle short loop", async () => {
  const queue = createFrequencyQueue({
    frequency: 1,
    worker: () => Promise.resolve(),
  });

  await queue.onIdle();
});

test("onIdle", async () => {
  const queue = createFrequencyQueue({
    frequency: 1,
    worker: () => Promise.resolve(),
  });

  queue.add();

  const promise = queue.onIdle();

  queue.start();

  await promise;
});

test("onIdle twice", async () => {
  const queue = createFrequencyQueue({
    frequency: 1_000,
    worker: () => Promise.resolve(),
  });

  queue.add();

  queue.onIdle();

  queue.start();

  queue.pause();

  queue.add();

  const promise = queue.onIdle();

  queue.start();

  await promise;
});

test("onEmpty short loop", async () => {
  const queue = createFrequencyQueue({
    frequency: 1,
    worker: () => Promise.resolve(),
  });

  await queue.onEmpty();
});

test("onEmpty", async () => {
  const queue = createFrequencyQueue({
    frequency: 1,
    worker: () => Promise.resolve(),
  });

  queue.add();

  const promise = queue.onEmpty();

  queue.start();

  await promise;
});

test("onEmpty twice", async () => {
  const queue = createFrequencyQueue({
    frequency: 1_000,
    worker: () => Promise.resolve(),
  });

  queue.add();

  queue.onEmpty();

  queue.start();

  queue.pause();

  queue.add();

  const promise = queue.onEmpty();

  queue.start();

  await promise;
});

test("frequency", async () => {
  const func = vi.fn(() => Promise.resolve());

  const queue = createFrequencyQueue({
    frequency: 2,
    worker: func,
  });

  queue.add();
  queue.add();
  queue.add();
  queue.add();

  queue.start();

  expect(queue.size()).toBe(2);
  expect(func).toHaveBeenCalledTimes(2);

  await new Promise((resolve) => setTimeout(resolve, 1_000));

  expect(queue.size()).toBe(0);
  expect(func).toHaveBeenCalledTimes(4);
});

test.todo("event loop");

test("parameter type", () => {
  const queue = createFrequencyQueue({
    frequency: 1,
    worker: (_arg: "a" | "b" | "c") => Promise.resolve(),
  });

  assertType<(task: "a" | "b" | "c") => Promise<void>>(queue.add);
});
