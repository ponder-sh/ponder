import { promiseWithResolvers } from "@/utils/promiseWithResolvers.js";
import { expect, test } from "vitest";
import { mergeAsyncGenerators } from "./generators.js";

test("mergeAsyncGenerators", async () => {
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

test("mergeAsyncGenerators results", async () => {
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
  await new Promise((res) => setTimeout(res));

  lock.resolve();

  await new Promise((res) => setTimeout(res));

  expect(results).toStrictEqual([1, 2, 3, 4]);
});
