import { expect, test, vi } from "vitest";
import { wait } from "../../core/src/utils/wait.js";
import { poll } from "./poll.js";

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
