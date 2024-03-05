import { assertType, expect, test, vi } from "vitest";
import { promiseWithResolvers } from "./promiseWithResolvers.js";
import { createQueue } from "./queue.js";

test("add resolves", async () => {
  const queue = createQueue({
    concurrency: 1,
    frequency: 1,
    worker: () => Promise.resolve(1),
  });

  queue.start();

  const promise = queue.add();

  expect(await promise).toBe(1);
});

test("add rejects", async () => {
  let rejected = false;

  const queue = createQueue({
    concurrency: 1,
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
  const queue = createQueue({
    concurrency: 1,
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

  const queue = createQueue({
    concurrency: 1,
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
  const queue = createQueue({
    concurrency: 1,
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
  const queue = createQueue({
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
  const queue = createQueue({
    concurrency: 1,
    frequency: 1,
    worker: () => Promise.resolve(),
  });

  expect(queue.isStarted()).toBe(false);

  queue.start();

  expect(queue.isStarted()).toBe(true);
});

test("start", async () => {
  const queue = createQueue({
    concurrency: 1,
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
  const queue = createQueue({
    concurrency: 1,
    frequency: 1,
    worker: () => Promise.resolve(),
  });

  queue.start();
  queue.pause();

  queue.add();

  expect(queue.size()).toBe(1);
});

test("onIdle short loop", async () => {
  const queue = createQueue({
    concurrency: 1,
    frequency: 1,
    worker: () => Promise.resolve(),
  });

  await queue.onIdle();
});

test("onIdle", async () => {
  const queue = createQueue({
    concurrency: 1,
    worker: () => Promise.resolve(),
  });

  queue.add();

  const promise = queue.onIdle();

  queue.start();

  await promise;
});

test("onIdle twice", async () => {
  const queue = createQueue({
    concurrency: 1,
    frequency: 1,
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
  const queue = createQueue({
    concurrency: 1,
    frequency: 1,
    worker: () => Promise.resolve(),
  });

  await queue.onEmpty();
});

test("onEmpty", async () => {
  const queue = createQueue({
    concurrency: 1,
    frequency: 1,
    worker: () => Promise.resolve(),
  });

  queue.add();

  const promise = queue.onEmpty();

  queue.start();

  await promise;
});

test("onEmpty twice", async () => {
  const queue = createQueue({
    concurrency: 1,
    frequency: 1,
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

test("concurrency", () => {
  const func = vi.fn(() => Promise.resolve());

  const queue = createQueue({
    concurrency: 2,
    frequency: 5,
    worker: func,
  });

  queue.add();
  queue.add();
  queue.add();
  queue.add();

  queue.start();
  queue.pause();

  expect(queue.size()).toBe(2);
  expect(func).toHaveBeenCalledTimes(2);
});

test("frequency", async () => {
  const func = vi.fn(() => Promise.resolve());

  const queue = createQueue({
    frequency: 2,
    concurrency: 5,
    worker: func,
  });

  queue.add();
  queue.add();
  queue.add();
  queue.add();

  queue.start();

  expect(queue.size()).toBe(2);
  expect(func).toHaveBeenCalledTimes(2);

  await new Promise((resolve) => setTimeout(resolve, 1_010));

  expect(queue.size()).toBe(0);
  expect(func).toHaveBeenCalledTimes(4);
});

test("event loop", async () => {
  const out: number[] = [];

  const queue1 = createQueue({
    concurrency: 1,
    worker: () => {
      out.push(1);
      return Promise.resolve();
    },
  });

  const queue2 = createQueue({
    concurrency: 1,
    worker: () => {
      out.push(2);
      return Promise.resolve();
    },
  });

  for (let i = 0; i < 10; i++) {
    queue1.add();
    queue2.add();
  }

  queue1.start();
  queue2.start();

  await Promise.all([queue1.onIdle(), queue2.onIdle()]);

  const expectedOut: number[] = [];

  for (let i = 0; i < 10; i++) {
    expectedOut.push(1, 2);
  }

  expect(out).toStrictEqual(expectedOut);
});

test("add type", () => {
  const queue = createQueue({
    concurrency: 1,
    worker: (_arg: "a" | "b" | "c") => Promise.resolve(),
  });

  assertType<(task: "a" | "b" | "c") => Promise<void>>(queue.add);
});
