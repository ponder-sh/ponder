import { promiseWithResolvers } from "@/utils/promiseWithResolvers.js";
import { expect, test } from "vitest";
import {
  bufferAsyncGenerator,
  createCallbackGenerator,
  mergeAsyncGenerators,
} from "./generators.js";

test("mergeAsyncGenerators()", async () => {
  const p1 = promiseWithResolvers<number>();
  const p2 = promiseWithResolvers<number>();
  const p3 = promiseWithResolvers<number>();
  const p4 = promiseWithResolvers<number>();

  async function* generator1() {
    yield await p1.promise;
    yield await p2.promise;
  }

  async function* generator2() {
    yield await p3.promise;
    yield await p4.promise;
  }

  const results: number[] = [];
  const generator = mergeAsyncGenerators([generator1(), generator2()]);

  (async () => {
    for await (const result of generator) {
      results.push(result);
    }
  })();

  p1.resolve(1);
  p2.resolve(2);
  await new Promise((res) => setTimeout(res));
  p3.resolve(3);
  p4.resolve(4);
  await new Promise((res) => setTimeout(res));

  expect(results).toStrictEqual([1, 2, 3, 4]);
});

test("mergeAsyncGenerators() yields all results", async () => {
  const p1 = promiseWithResolvers<number>();
  const p2 = promiseWithResolvers<number>();
  const p3 = promiseWithResolvers<number>();
  const p4 = promiseWithResolvers<number>();

  async function* generator1() {
    yield await p1.promise;
    yield await p2.promise;
  }

  async function* generator2() {
    yield await p3.promise;
    yield await p4.promise;
  }

  const results: number[] = [];
  const generator = mergeAsyncGenerators([generator1(), generator2()]);

  const lock = promiseWithResolvers<void>();

  (async () => {
    for await (const result of generator) {
      await lock.promise;
      results.push(result);
    }
  })();

  p1.resolve(1);
  p2.resolve(2);

  await new Promise((res) => setTimeout(res));

  p3.resolve(3);
  p4.resolve(4);

  lock.resolve();

  await new Promise((res) => setTimeout(res));

  expect(results).toStrictEqual([1, 2, 3, 4]);
});

test("bufferAsyncGenerator() prefetches results", async () => {
  let sum = 0;

  async function* inputGenerator() {
    yield;
    sum += 1;
    yield;
    sum += 1;
    yield;
    sum += 1;
    yield;
    sum += 1;
  }

  const generator = bufferAsyncGenerator(inputGenerator(), 2);

  let result = await generator.next();
  expect(result.done).toBe(false);
  expect(sum).toBe(2);

  result = await generator.next();
  expect(result.done).toBe(false);
  expect(sum).toBe(3);

  result = await generator.next();
  expect(result.done).toBe(false);
  expect(sum).toBe(4);

  result = await generator.next();
  expect(result.done).toBe(false);
  expect(sum).toBe(4);

  result = await generator.next();
  expect(result.done).toBe(true);
});

test("bufferAsyncGenerator() yields all results", async () => {
  const p1 = promiseWithResolvers<number>();
  const p2 = promiseWithResolvers<number>();
  const p3 = promiseWithResolvers<number>();
  const p4 = promiseWithResolvers<number>();

  async function* inputGenerator() {
    yield await p1.promise;
    yield await p2.promise;
    yield await p3.promise;
    yield await p4.promise;
  }

  const generator = bufferAsyncGenerator(inputGenerator(), 2);

  let resultPromise = generator.next();
  p1.resolve(1);
  let result = await resultPromise;
  expect(result.done).toBe(false);
  expect(result.value).toBe(1);

  resultPromise = generator.next();
  p2.resolve(2);
  result = await resultPromise;
  expect(result.done).toBe(false);
  expect(result.value).toBe(2);

  resultPromise = generator.next();
  p3.resolve(3);
  result = await resultPromise;
  expect(result.done).toBe(false);
  expect(result.value).toBe(3);

  resultPromise = generator.next();
  p4.resolve(4);
  result = await resultPromise;
  expect(result.done).toBe(false);
  expect(result.value).toBe(4);

  result = await generator.next();
  expect(result.done).toBe(true);
});

test("createCallbackGenerator()", async () => {
  const { callback, generator } = createCallbackGenerator<number>();

  (async () => {
    for (let i = 0; i < 5; i++) {
      callback(i);
      await new Promise((res) => setTimeout(res, 100));
    }
  })();

  for await (const value of generator) {
    if (value === 4) break;
  }
});
