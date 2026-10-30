import { expect, test } from "vitest";
import { partition } from "@/utils/partition.js";

test("partition", () => {
  let [left, right] = partition([1, 2, 3, 4, 5], (n) => n <= 2);
  expect(left).toMatchInlineSnapshot(`
    [
      1,
      2,
    ]
  `);
  expect(right).toMatchInlineSnapshot(`
    [
      3,
      4,
      5,
    ]
  `);

  [left, right] = partition([1, 2, 3, 4, 5], (n) => n < 6);
  expect(left).toMatchInlineSnapshot(`
    [
      1,
      2,
      3,
      4,
      5,
    ]
  `);
  expect(right).toMatchInlineSnapshot(`[]`);

  [left, right] = partition([2, 5], (n) => n <= 5);
  expect(left).toMatchInlineSnapshot(`
    [
      2,
      5,
    ]
  `);
  expect(right).toMatchInlineSnapshot(`[]`);

  [left, right] = partition([1], (n) => n > 1);
  expect(left).toMatchInlineSnapshot(`[]`);
  expect(right).toMatchInlineSnapshot(`
    [
      1,
    ]
  `);

  [left, right] = partition([1, 2, 3], (n) => n > 0);
  expect(left).toMatchInlineSnapshot(`
    [
      1,
      2,
      3,
    ]
  `);
  expect(right).toMatchInlineSnapshot(`[]`);

  [left, right] = partition([1, 2, 3], (n) => n > 5);
  expect(left).toMatchInlineSnapshot(`[]`);
  expect(right).toMatchInlineSnapshot(`
    [
      1,
      2,
      3,
    ]
  `);
});
