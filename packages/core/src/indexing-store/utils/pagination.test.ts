import { expect, test } from "vitest";

import { validateSkip, validateTake } from "./pagination.js";

test("validateSkip should throw if more than 5000 records", async () => {
  expect(() => validateSkip(5001)).toThrowError(
    "Invalid query. Cannot skip more than 5000 rows.",
  );
});

test("validateTake should throw if more than 1000 rows", async () => {
  expect(() => validateTake(5001)).toThrowError(
    "Invalid query. Cannot take more than 1000 rows.",
  );
});
