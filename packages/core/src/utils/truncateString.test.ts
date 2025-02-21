import { describe, expect } from "vitest";
import { test } from "vitest";
import { truncateEventName } from "./truncateString.js";

describe("truncateEventName", () => {
  test("returns the same string if it's within maxLength", () => {
    expect(truncateEventName("ShortName", 24)).toBe("ShortName");
  });

  test("truncates a long string correctly", () => {
    expect(truncateEventName("VeryLongContractEventName", 24)).toBe(
      "VeryLo...tName",
    );
  });

  test("handles maxLength shorter than ellipsis", () => {
    expect(truncateEventName("VeryLongName", 5)).toBe("V...e");
  });

  test("handles exact maxLength without truncation", () => {
    expect(truncateEventName("ExactLengthHere", 16)).toBe("ExactLengthHere");
  });

  test("handles edge case with maxLength of 3", () => {
    expect(truncateEventName("LongName", 3)).toBe("...");
  });
});
