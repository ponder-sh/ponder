import { expect, test, vi } from "vitest";
import { wait } from "../../core/src/utils/wait.js";
import { debounce } from "./debounce.js";

test("invoke function after timeout", async () => {
  const fun = vi.fn(() => {});
  const { call } = debounce(10, fun);

  call();

  expect(fun).toHaveBeenCalledTimes(0);

  await wait(20);

  expect(fun).toHaveBeenCalledTimes(1);
});

test("skips invocation during timeout", async () => {
  const fun = vi.fn(() => {});
  const { call } = debounce(10, fun);

  call();
  call();
  call();
  call();
  call();

  await wait(20);

  expect(fun).toHaveBeenCalledTimes(1);
});

test("updates arguments during timeout", async () => {
  const fun = vi.fn((n: number) => {
    n;
  });
  const { call } = debounce(10, fun);

  call(1);
  call(2);
  call(3);
  call(4);
  call(5);

  await wait(20);

  expect(fun).toHaveBeenCalledTimes(1);
  expect(fun).toHaveBeenCalledWith(5);
});

test("cancel", async () => {
  const fun = vi.fn(() => {});
  const { call, cancel } = debounce(10, fun);

  call();
  cancel();

  expect(fun).toHaveBeenCalledTimes(0);

  await wait(20);

  expect(fun).toHaveBeenCalledTimes(0);
});
