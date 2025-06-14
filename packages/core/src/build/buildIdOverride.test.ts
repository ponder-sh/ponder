import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getBuildId } from "./index.js";

describe("getBuildId", () => {
  it("should use the env variable if set and valid", () => {
    const override = "abcdef1234";
    process.env.PONDER_BUILD_ID_OVERRIDE = override;
    const result = getBuildId({
      configHash: "a",
      schemaHash: "b",
      indexingHash: "c",
    });
    expect(result).toBe(override);
    process.env.PONDER_BUILD_ID_OVERRIDE = undefined;
  });

  it("should fallback to hash if env variable is not set", () => {
    process.env.PONDER_BUILD_ID_OVERRIDE = undefined;
    const expected = createHash("sha256")
      .update("1")
      .update("a")
      .update("b")
      .update("c")
      .digest("hex")
      .slice(0, 10);
    const result = getBuildId({
      configHash: "a",
      schemaHash: "b",
      indexingHash: "c",
    });
    expect(result).toBe(expected);
  });

  it("should throw if env variable is wrong length", () => {
    process.env.PONDER_BUILD_ID_OVERRIDE = "abc";
    expect(() =>
      getBuildId({ configHash: "a", schemaHash: "b", indexingHash: "c" }),
    ).toThrowError(
      /PONDER_BUILD_ID_OVERRIDE must be exactly 10 lowercase hexadecimal characters/,
    );
    process.env.PONDER_BUILD_ID_OVERRIDE = undefined;
  });

  it("should throw if env variable is not hex", () => {
    process.env.PONDER_BUILD_ID_OVERRIDE = "zzzzzzzzzz";
    expect(() =>
      getBuildId({ configHash: "a", schemaHash: "b", indexingHash: "c" }),
    ).toThrowError(
      /PONDER_BUILD_ID_OVERRIDE must be exactly 10 lowercase hexadecimal characters/,
    );
    process.env.PONDER_BUILD_ID_OVERRIDE = undefined;
  });
});
