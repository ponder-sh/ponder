import { expect } from "vitest";
import { test } from "vitest";
import { truncate } from "./truncate.js";

test("truncates a long string correctly", () => {
  expect(truncate("EnergyMarketOrderBookV1Contract", 24)).toBe(
    "EnergyMark...V1Contract",
  );
});

test("returns the same string if it's within maxLength", () => {
  expect(truncate("EnergyMarketOrderBookV1Contract", 31)).toBe(
    "EnergyMarketOrderBookV1Contract",
  );
});

test("truncates a long string correctly with default maxLength", () => {
  expect(truncate("EnergyMarketOrderBookV1Contract:Action")).toBe(
    "EnergyMarketOrde...1Contract:Action",
  );
});
