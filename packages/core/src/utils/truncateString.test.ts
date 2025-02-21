import { describe, expect } from "vitest";
import { test } from "vitest";
import { truncateEventName } from "./truncateString.js";

describe("truncateEventName", () => {
  test("truncates a long string correctly", () => {
    expect(truncateEventName("EnergyMarketOrderBookV1Contract", 24)).toBe(
      "EnergyMark...V1Contract",
    );
  });

  test("returns the same string if it's within maxLength", () => {
    expect(truncateEventName("EnergyMarketOrderBookV1Contract", 31)).toBe(
      "EnergyMarketOrderBookV1Contract",
    );
  });

  test("truncates a long string correctly with default maxLength", () => {
    expect(truncateEventName("EnergyMarketOrderBookV1Contract")).toBe(
      "EnergyMark...V1Contract",
    );
  });
});
