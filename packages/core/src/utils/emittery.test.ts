import { expect, test } from "vitest";

import { Emittery } from "./emittery.js";
import { range } from "./range.js";
import { wait } from "./wait.js";

test("onSerial processes new event data immediately", async () => {
  const emitter = new Emittery();

  const collected: number[] = [];

  emitter.onSerial("test", async ({ data }) => {
    await wait(25);
    collected.push(data);
  });

  await emitter.emit("test", { data: 0 });

  expect(collected[0]).toBe(0);
  expect(collected.length).toBe(1);
});

test("onSerial processes first and last event data", async () => {
  const emitter = new Emittery();

  const collected: number[] = [];

  emitter.onSerial("test", async ({ data }) => {
    await wait(25);
    collected.push(data);
  });

  for (const idx of range(0, 99)) {
    emitter.emit("test", { data: idx });
    await wait(1);
  }

  await emitter.emit("test", { data: 99 });

  // `collected` should look similar to [0, 21, 43, 64, 99]
  expect(collected[0]).toBe(0);
  expect(collected[collected.length - 1]).toBe(99);
  expect(collected.length).toBeGreaterThan(2);
});

test("cancelMutexes cancels work in progress listener", async () => {
  const emitter = new Emittery();

  let started = false;
  let finished = false;

  emitter.onSerial("test", async () => {
    started = true;
    await wait(25);
    finished = true;
  });

  emitter.emit("test", { data: 0 });

  await wait(10);
  emitter.cancelMutexes();

  expect(started).toBe(true);
  expect(finished).toBe(false);
});
