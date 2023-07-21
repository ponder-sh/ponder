import { expect, test } from "vitest";

import { validateFilter } from "./utils";

test("parser should only allow 1000 records", async () => {
  expect(() => validateFilter({ first: 1001 })).toThrowError(
    /Cannot query more than 1000 rows./
  );
});

test("parser should only allow 5000 skips", async () => {
  expect(() => validateFilter({ skip: 5001 })).toThrowError(
    /Cannot skip more than 5000 rows./
  );
});
