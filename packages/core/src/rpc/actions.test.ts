import { BlockNotFoundError } from "viem";
import { expect, test } from "vitest";
import { isBlockNotFoundError, isNullRoundError } from "./actions.js";

test("isNullRoundError returns true for RPC error code 12", () => {
  const error = Object.assign(new Error("request failed"), {
    cause: { code: 12, message: "requested epoch was a null round" },
  });
  expect(isNullRoundError(error)).toBe(true);
});

test("isNullRoundError returns true for 'null round' message", () => {
  const error = new Error("requested epoch was a null round");
  expect(isNullRoundError(error)).toBe(true);
});

test("isNullRoundError returns false for BlockNotFoundError", () => {
  const error = new BlockNotFoundError({ blockNumber: 100n });
  expect(isNullRoundError(error)).toBe(false);
});

test("isNullRoundError returns false for unrelated errors", () => {
  expect(isNullRoundError(new Error("timeout"))).toBe(false);
  expect(isNullRoundError(null)).toBe(false);
  expect(isNullRoundError(undefined)).toBe(false);
});

test("isNullRoundError returns false for non-12 RPC error codes", () => {
  const error = Object.assign(new Error("request failed"), {
    cause: { code: -32000, message: "server error" },
  });
  expect(isNullRoundError(error)).toBe(false);
});

test("isBlockNotFoundError returns true for BlockNotFoundError", () => {
  const error = new BlockNotFoundError({ blockNumber: 100n });
  expect(isBlockNotFoundError(error)).toBe(true);
});

test("isBlockNotFoundError returns true for wrapped BlockNotFoundError", () => {
  const cause = new BlockNotFoundError({ blockNumber: 100n });
  const error = Object.assign(new Error("wrapper"), { cause });
  expect(isBlockNotFoundError(error)).toBe(true);
});

test("isBlockNotFoundError returns true for null round (code 12)", () => {
  const error = Object.assign(new Error("request failed"), {
    cause: { code: 12, message: "requested epoch was a null round" },
  });
  expect(isBlockNotFoundError(error)).toBe(true);
});

test("isBlockNotFoundError returns false for unrelated errors", () => {
  expect(isBlockNotFoundError(new Error("timeout"))).toBe(false);
  expect(isBlockNotFoundError(null)).toBe(false);
  expect(isBlockNotFoundError(undefined)).toBe(false);
});
