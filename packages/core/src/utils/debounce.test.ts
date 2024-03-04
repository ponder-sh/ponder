import { expect, test, vi } from "vitest";
import { debounce } from "./debounce.js";
import { wait } from "./wait.js";

test("invokes function right away", () => {
  const fun = vi.fn(() => {});
  const d = debounce(0, fun);

  d();

  expect(fun).toHaveBeenCalledTimes(1);
});

test("invoke function after timeout", async () => {
  const fun = vi.fn(() => {});
  const d = debounce(10, fun);

  d();
  d();

  expect(fun).toHaveBeenCalledTimes(1);

  await wait(20);

  expect(fun).toHaveBeenCalledTimes(2);
});

test("skips invocation during timeout", async () => {
  const fun = vi.fn(() => {});
  const d = debounce(10, fun);

  d();
  d();
  d();
  d();
  d();

  await wait(20);

  expect(fun).toHaveBeenCalledTimes(2);
});

test("updates arguments during timeout", async () => {
  const fun = vi.fn((n: number) => {
    n;
  });
  const d = debounce(10, fun);

  d(1);
  d(2);
  d(3);
  d(4);
  d(5);

  await wait(20);

  expect(fun).toHaveBeenCalledTimes(2);
  expect(fun).toHaveBeenCalledWith(1);
  expect(fun).toHaveBeenCalledWith(5);
});

test("sets last timestamp after immediate invocation", async () => {
  const fun = vi.fn(() => {});
  const d = debounce(10, fun);

  d();

  await wait(20);

  d();

  expect(fun).toHaveBeenCalledTimes(2);
});

test("sets last timestamp after timeout", async () => {
  const fun = vi.fn(() => {});
  const d = debounce(10, fun);

  d();
  d();

  await wait(25);

  d();

  expect(fun).toHaveBeenCalledTimes(3);
});
