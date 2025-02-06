import { chunk } from "@/utils/chunk.js";
import { expect, test } from "vitest";

test("chunk", () => {
  let result = chunk([1, 2, 3, 4, 5, 6, 7, 8, 9], 3);
  expect(result).toStrictEqual([
    [1, 2, 3],
    [4, 5, 6],
    [7, 8, 9],
  ]);

  result = chunk([], 3);
  expect(result).toStrictEqual([]);
});
