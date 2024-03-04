import { expect, test, vi } from "vitest";
import { wait } from "../../core/src/utils/wait.js";
import { debounce } from "./debounce.js";

test("invoke function after timeout", async () => {
  const fun = vi.fn(() => {});
  const { callback } = debounce(10, fun);

  callback();

  expect(fun).toHaveBeenCalledTimes(0);

  await wait(20);

  expect(fun).toHaveBeenCalledTimes(1);
});

test("skips invocation during timeout", async () => {
  const fun = vi.fn(() => {});
  const { callback } = debounce(10, fun);

  callback();
  callback();
  callback();
  callback();
  callback();

  await wait(20);

  expect(fun).toHaveBeenCalledTimes(1);
});

test("updates arguments during timeout", async () => {
  const fun = vi.fn((n: number) => {
    n;
  });
  const { callback } = debounce(10, fun);

  callback(1);
  callback(2);
  callback(3);
  callback(4);
  callback(5);

  await wait(20);

  expect(fun).toHaveBeenCalledTimes(1);
  expect(fun).toHaveBeenCalledWith(5);
});

test("cancel", async () => {
  const fun = vi.fn(() => {});
  const { callback, cancel } = debounce(10, fun);

  callback();
  cancel();

  expect(fun).toHaveBeenCalledTimes(0);

  await wait(20);

  expect(fun).toHaveBeenCalledTimes(0);
});
