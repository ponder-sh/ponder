import { afterEach, describe, expect, test } from "vitest";
import { hardInvariant, invariant } from "./invariant.js";

describe("invariant", () => {
  const originalEnv = process.env.PONDER_DEBUG;

  afterEach(() => {
    if (originalEnv === undefined) {
      process.env.PONDER_DEBUG = undefined;
    } else {
      process.env.PONDER_DEBUG = originalEnv;
    }
  });

  test("does not throw in production mode when condition is false", () => {
    process.env.PONDER_DEBUG = undefined;
    expect(() => invariant(false, "should not throw")).not.toThrow();
  });

  test("does not throw when condition is true", () => {
    process.env.PONDER_DEBUG = "true";
    expect(() => invariant(true, "should not throw")).not.toThrow();
  });

  test("throws in debug mode when condition is false", () => {
    process.env.PONDER_DEBUG = "true";
    expect(() => invariant(false, "test message")).toThrowError(
      "Invariant violation: test message",
    );
  });

  test("narrows type when condition is true", () => {
    const value: string | undefined = "hello";
    invariant(value !== undefined, "value should be defined");
    // TypeScript should now know `value` is `string`
    const _length: number = value.length;
    expect(_length).toBe(5);
  });
});

describe("hardInvariant", () => {
  test("throws when condition is false regardless of env", () => {
    process.env.PONDER_DEBUG = undefined;
    expect(() => hardInvariant(false, "test message")).toThrowError(
      "Invariant violation: test message",
    );
  });

  test("does not throw when condition is true", () => {
    expect(() => hardInvariant(true, "should not throw")).not.toThrow();
  });

  test("narrows type when condition is true", () => {
    const value: string | undefined = "hello";
    hardInvariant(value !== undefined, "value should be defined");
    const _length: number = value.length;
    expect(_length).toBe(5);
  });
});
