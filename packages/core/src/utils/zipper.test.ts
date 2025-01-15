import { zipper, zipperMany } from "@/utils/zipper.js";
import { expect, test } from "vitest";
test("zipper", () => {
  const result = zipper([1, 3, 5], [2, 4, 6]);
  expect(result).toStrictEqual([1, 2, 3, 4, 5, 6]);
});

test("zipperMany", () => {
  const result = zipperMany([
    [1, 3, 5],
    [2, 4, 6],
    [7, 8, 9],
  ]);
  expect(result).toStrictEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
});
