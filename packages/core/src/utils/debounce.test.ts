import { expect, test } from "vitest";
import { debounce } from "./debounce.js";
import { wait } from "./wait.js";

test("invokes function right away", () => {
  let i = 0;
  const set = (_i: number) => {
    i = _i;
  };
  const d = debounce(0, set);

  d(1);
  expect(i).toBe(1);
});

test("invokes function after interval passes", async () => {
  let i = 0;
  const set = (_i: number) => {
    i = _i;
  };
  const d = debounce(0, set);

  d(1);

  await wait(1);

  d(2);
  expect(i).toBe(2);
});

test("sets timeout to run after interval", async () => {
  let i = 0;
  const increment = (_i: number) => {
    i = _i;
  };
  const d = debounce(1, increment);

  d(1);

  d(2);

  await wait(1);

  expect(i).toBe(2);
});

test("updates arguments during timeout", async () => {
  let i = 0;
  const set = (_i: number) => {
    i = _i;
  };
  const d = debounce(1, set);

  d(1);

  d(2);
  d(3);
  d(4);
  d(1);

  await wait(1);

  expect(i).toBe(1);
});

test("invokes function once per interval", async () => {
  let i = 0;
  const increment = () => {
    i++;
  };
  const d = debounce(1, increment);

  d();

  d();
  d();
  d();
  d();

  await wait(1);

  expect(i).toBe(2);
});
