import { expect, test, vi } from "vitest";
import { poll } from "./poll.js";
import { wait } from "./wait.js";

test("poll", async () => {
  const fn = vi.fn(() => {});

  const unpoll = poll(fn, { interval: 10 });

  await wait(12);

  expect(fn).toHaveBeenCalledTimes(1);

  unpoll();
});

test("unpoll", async () => {
  const fn = vi.fn(() => {});

  const unpoll = poll(fn, { interval: 10 });

  unpoll();

  expect(fn).toHaveBeenCalledTimes(0);

  await wait(12);

  expect(fn).toHaveBeenCalledTimes(0);
});
