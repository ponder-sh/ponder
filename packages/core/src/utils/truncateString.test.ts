import { describe, expect, it } from "vitest";
import { truncateEventName } from "./truncateString.js";

describe("truncateEventName", () => {
  it("should return the original string if its length is less than or equal to the maxLength", () => {
    const input = "short string";
    const result = truncateEventName(input, 20);
    expect(result).toBe(input);
  });

  it("should truncate the string and add ellipsis in the middle if it exceeds the maxLength", () => {
    const input = "This is a very long string that needs to be truncated";
    const result = truncateEventName(input, 24);
    expect(result).toBe("This is...be truncated");
  });

  it("should handle edge cases where maxLength is very small", () => {
    const input = "edge case";
    const result = truncateEventName(input, 5);
    expect(result).toBe("e...e");
  });

  it("should handle edge cases where maxLength is exactly the length of the string", () => {
    const input = "exact length";
    const result = truncateEventName(input, 12);
    expect(result).toBe(input);
  });

  it("should handle edge cases where maxLength is 0", () => {
    const input = "zero length";
    const result = truncateEventName(input, 0);
    expect(result).toBe("...");
  });

  it("should handle edge cases where maxLength is 1", () => {
    const input = "one length";
    const result = truncateEventName(input, 1);
    expect(result).toBe("...");
  });

  it("should use the default maxLength if maxLength is not defined", () => {
    const input = "This is a very long string that needs to be truncated";
    const result = truncateEventName(input);
    expect(result).toBe("This is a...e truncated");
  });

  it("should return the original string if its length is less than or equal to the default maxLength", () => {
    const input = "short string";
    const result = truncateEventName(input);
    expect(result).toBe(input);
  });

  it("should handle edge cases where the string is empty", () => {
    const input = "";
    const result = truncateEventName(input);
    expect(result).toBe("");
  });

  it("should handle edge cases where the string is exactly the default maxLength", () => {
    const input = "This is exactly 24 chars";
    const result = truncateEventName(input);
    expect(result).toBe(input);
  });
});
