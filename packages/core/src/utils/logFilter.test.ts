import { expect, test } from "vitest";

import { buildLogFilterFragments } from "./logFilter";

test("buildLogFilterFragments generates 1 log filter fragment for null filter", () => {
  const logFilterFragments = buildLogFilterFragments({});

  expect(logFilterFragments).toMatchObject([
    {
      address: null,
      topic0: null,
      topic1: null,
      topic2: null,
      topic3: null,
    },
  ]);
});

test("buildLogFilterFragments generates 1 log filter fragment for simple filter", () => {
  const logFilterFragments = buildLogFilterFragments({
    address: "0xa",
  });

  expect(logFilterFragments).toMatchObject([
    {
      address: "0xa",
      topic0: null,
      topic1: null,
      topic2: null,
      topic3: null,
    },
  ]);
});

test("buildLogFilterFragments generates 4 log filter fragment for 2x2 filter", () => {
  const logFilterFragments = buildLogFilterFragments({
    address: ["0xa", "0xb"],
    topics: [["0xc", "0xd"], null, "0xe", null],
  });

  expect(logFilterFragments).toMatchObject([
    {
      address: "0xa",
      topic0: "0xc",
      topic1: null,
      topic2: "0xe",
      topic3: null,
    },
    {
      address: "0xa",
      topic0: "0xd",
      topic1: null,
      topic2: "0xe",
      topic3: null,
    },
    {
      address: "0xb",
      topic0: "0xc",
      topic1: null,
      topic2: "0xe",
      topic3: null,
    },
    {
      address: "0xb",
      topic0: "0xd",
      topic1: null,
      topic2: "0xe",
      topic3: null,
    },
  ]);
});

test("buildLogFilterFragments generates 12 log filter fragment for 2x2x3 filter", () => {
  const logFilterFragments = buildLogFilterFragments({
    address: ["0xa", "0xb"],
    topics: [["0xc", "0xd"], null, ["0xe", "0xf", "0x1"], null],
  });

  expect(logFilterFragments.length).toBe(12);
});
