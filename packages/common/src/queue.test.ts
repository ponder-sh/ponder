import { expect, test, vi } from "vitest";
import { promiseWithResolvers } from "./promiseWithResolvers.js";
import { createQueue } from "./queue.js";

test("add resolves", async () => {
  const queue = createQueue({
    concurrency: 1,
    frequency: 1,
    initialStart: true,
    browser: false,
    worker: () => Promise.resolve(1),
  });

  const promise = queue.add();

  expect(await promise).toBe(1);
});

test("add rejects", async () => {
  let rejected = false;

  const queue = createQueue({
    concurrency: 1,
    frequency: 1,
    browser: false,
    worker: () => Promise.reject(),
  });

  const promise = queue.add();

  await queue.start();

  await promise.catch(() => {
    rejected = true;
  });

  expect(rejected).toBe(true);
});

test("size", async () => {
  const queue = createQueue({
    concurrency: 1,
    frequency: 1,
    browser: false,
    worker: () => Promise.resolve(),
  });

  queue.add();

  expect(queue.size()).toBe(1);

  await queue.start();

  expect(queue.size()).toBe(0);
});

test("pending", async () => {
  const { promise, resolve } = promiseWithResolvers<void>();

  const queue = createQueue({
    concurrency: 1,
    frequency: 1,
    initialStart: true,
    browser: false,
    worker: () => promise,
  });

  queue.add();

  expect(await queue.pending()).toBe(1);

  resolve();

  expect(await queue.pending()).toBe(0);
});

test("clear", () => {
  const queue = createQueue({
    concurrency: 1,
    frequency: 1,
    browser: false,
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
    browser: false,
    worker: () => Promise.resolve(),
  });

  queue.add();
  queue.add();
  queue.add();

  await queue.start();
  queue.clear();

  await queue.onIdle();

  expect(queue.size()).toBe(0);
  expect(await queue.pending()).toBe(0);
});

test("isStarted", async () => {
  const queue = createQueue({
    concurrency: 1,
    frequency: 1,
    browser: false,
    worker: () => Promise.resolve(),
  });

  expect(queue.isStarted()).toBe(false);

  await queue.start();

  expect(queue.isStarted()).toBe(true);
});

test("initial start", async () => {
  const queue = createQueue({
    concurrency: 1,
    frequency: 1,
    browser: false,
    initialStart: true,
    worker: () => Promise.resolve(),
  });

  expect(queue.isStarted()).toBe(true);

  await queue.add();

  expect(queue.size()).toBe(0);
});

test("start", async () => {
  const queue = createQueue({
    concurrency: 1,
    frequency: 1,
    browser: false,
    worker: () => Promise.resolve(),
  });

  const promise = queue.add();

  expect(queue.size()).toBe(1);

  await queue.start();

  expect(queue.isStarted()).toBe(true);

  await promise;

  expect(queue.size()).toBe(0);
});

test("pause", () => {
  const queue = createQueue({
    concurrency: 1,
    frequency: 1,
    browser: false,
    initialStart: true,
    worker: () => Promise.resolve(),
  });

  queue.pause();

  queue.add();

  expect(queue.size()).toBe(1);
});

test.todo("restart");

test("onIdle short loop", async () => {
  const queue = createQueue({
    concurrency: 1,
    frequency: 1,
    browser: false,
    worker: () => Promise.resolve(),
  });

  await queue.onIdle();
});

test("onIdle", async () => {
  const queue = createQueue({
    concurrency: 1,
    browser: false,
    worker: () => Promise.resolve(),
  });

  queue.add();

  const promise = queue.onIdle();

  await queue.start();

  await promise;
});

test("onIdle twice", async () => {
  const queue = createQueue({
    concurrency: 1,
    frequency: 1,
    browser: false,
    worker: () => Promise.resolve(),
  });

  queue.add();

  queue.onIdle();

  await queue.start();

  queue.pause();

  queue.add();

  const promise = queue.onIdle();

  await queue.start();

  await promise;
});

test("onEmpty short loop", async () => {
  const queue = createQueue({
    concurrency: 1,
    frequency: 1,
    browser: false,
    worker: () => Promise.resolve(),
  });

  await queue.onEmpty();
});

test("onEmpty", async () => {
  const queue = createQueue({
    concurrency: 1,
    frequency: 1,
    browser: false,
    worker: () => Promise.resolve(),
  });

  queue.add();

  const promise = queue.onEmpty();

  await queue.start();

  await promise;
});

test("onEmpty twice", async () => {
  const queue = createQueue({
    concurrency: 1,
    frequency: 1,
    browser: false,
    worker: () => Promise.resolve(),
  });

  queue.add();

  queue.onEmpty();

  await queue.start();

  queue.pause();

  queue.add();

  const promise = queue.onEmpty();

  await queue.start();

  await promise;
});

test("concurrency", async () => {
  const func = vi.fn(() => Promise.resolve());

  const queue = createQueue({
    concurrency: 2,
    frequency: 5,
    browser: false,
    worker: func,
  });

  queue.add();
  queue.add();
  queue.add();
  queue.add();

  await queue.start();
  queue.pause();

  expect(queue.size()).toBe(2);
  expect(func).toHaveBeenCalledTimes(2);
});

test("frequency", async () => {
  const func = vi.fn(() => Promise.resolve());

  const queue = createQueue({
    frequency: 2,
    concurrency: 5,
    browser: false,
    worker: func,
  });

  queue.add();
  queue.add();
  queue.add();
  queue.add();

  await queue.start();

  expect(queue.size()).toBe(2);
  expect(func).toHaveBeenCalledTimes(2);

  await new Promise((resolve) => setTimeout(resolve, 1_010));

  expect(queue.size()).toBe(0);
  expect(func).toHaveBeenCalledTimes(4);
});

/**
 * Two queues running at the same time should alternate between events.
 * One queue running all its event in a row would mean the event loop
 * is being "starved".
 */
test("event loop", async () => {
  const out: number[] = [];

  const queue1 = createQueue({
    concurrency: 1,
    browser: false,
    worker: () => {
      out.push(1);
      return Promise.resolve();
    },
  });

  const queue2 = createQueue({
    concurrency: 1,
    browser: false,
    worker: () => {
      out.push(2);
      return Promise.resolve();
    },
  });

  for (let i = 0; i < 10; i++) {
    queue1.add();
    queue2.add();
  }

  await Promise.all([queue1.start(), queue2.start()]);
  await Promise.all([queue1.onIdle(), queue2.onIdle()]);

  const expectedOut: number[] = [];

  for (let i = 0; i < 10; i++) {
    expectedOut.push(1, 2);
  }

  expect(out).toStrictEqual(expectedOut);
});

test("update parameters", async () => {
  const func = vi.fn(() => Promise.resolve());

  const queue = createQueue({
    concurrency: 2,
    frequency: 5,
    browser: false,
    worker: func,
  });

  queue.add();
  queue.add();
  queue.add();
  queue.add();
  queue.add();
  queue.add();

  await queue.start();
  queue.pause();

  expect(queue.size()).toBe(4);
  expect(func).toHaveBeenCalledTimes(2);

  queue.setParameters({ concurrency: 4 });

  await queue.start();
  queue.pause();

  expect(queue.size()).toBe(0);
  expect(func).toHaveBeenCalledTimes(6);
});
