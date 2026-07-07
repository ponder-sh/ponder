import { expect, test } from "vitest";
import { isAsyncExecutionChain } from "./finality.js";

test("isAsyncExecutionChain()", () => {
  expect(isAsyncExecutionChain(143)).toBe(true);
  expect(isAsyncExecutionChain(10143)).toBe(true);
  expect(isAsyncExecutionChain(1)).toBe(false);
});
