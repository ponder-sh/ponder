import { expect, test } from "vitest";

import { ModelFilter } from "./store";
import { parseModelFilter } from "./utils";

test("parser should set limit to 100", async () => {
  const filter = parseModelFilter({});
  expect(filter.first).toBe(100);
});

test("parser should only allow 1000 records", async () => {
  expect(() => parseModelFilter({ first: 1001 })).toThrowError(
    /Cannot query more than 1000 rows./
  );
});

test("parser should only allow 5000 skips", async () => {
  expect(() => parseModelFilter({ skip: 5001 })).toThrowError(
    /Cannot skip more than 5000 rows./
  );
});

test("parser should not modify valid filter", async () => {
  const defaultFilter: ModelFilter = {
    first: 100,
    skip: 100,
    orderBy: "id",
    orderDirection: "asc",
    where: {
      id_in: [1, 2, 3],
    },
  };
  const filter = parseModelFilter(defaultFilter);

  expect(filter).toEqual(defaultFilter);
});
