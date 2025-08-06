import { partition } from "@/utils/partition.js";
import { expect, test } from "vitest";

test("partition", () => {
  let [left, right] = partition([1, 2, 3, 4, 5], (n) => n <= 2);
  expect(left).toStrictEqual([1, 2]);
  expect(right).toStrictEqual([3, 4, 5]);

  [left, right] = partition([1, 2, 3, 4, 5], (n) => n < 6);
  expect(left).toStrictEqual([1, 2, 3, 4, 5]);
  expect(right).toStrictEqual([]);

  [left, right] = partition([2, 5], (n) => n <= 5);
  expect(left).toStrictEqual([2, 5]);
  expect(right).toStrictEqual([]);

  [left, right] = partition([1], (n) => n > 1);
  expect(left).toStrictEqual([]);
  expect(right).toStrictEqual([1]);

  [left, right] = partition([1, 2, 3], (n) => n > 0);
  expect(left).toStrictEqual([1, 2, 3]);
  expect(right).toStrictEqual([]);

  [left, right] = partition([1, 2, 3], (n) => n > 5);
  expect(left).toStrictEqual([]);
  expect(right).toStrictEqual([1, 2, 3]);
});
