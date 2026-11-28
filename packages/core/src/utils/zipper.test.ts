import { expect, test } from "vitest";
import { zipper, zipperMany } from "@/utils/zipper.js";

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

test("zipper merges a large remaining left array", () => {
  const left = Array.from({ length: 1_000_000 }, (_, i) => i + 1);
  const result = zipper(left, [0]);

  expect(result).toHaveLength(left.length + 1);
  expect(result.every((value, index) => value === index)).toBe(true);
});

test("zipper merges a large remaining right array", () => {
  const right = Array.from({ length: 1_000_000 }, (_, i) => i + 1);
  const result = zipper([0], right);

  expect(result).toHaveLength(right.length + 1);
  expect(result.every((value, index) => value === index)).toBe(true);
});

test("zipperMany merges large arrays with a custom comparator", () => {
  const events = Array.from({ length: 1_000_000 }, (_, checkpoint) => ({
    checkpoint,
  }));
  const before = { checkpoint: -1 };
  const after = { checkpoint: events.length };

  const result = zipperMany(
    [[before], events, [after]],
    (a, b) => a.checkpoint - b.checkpoint,
  );

  expect(result).toHaveLength(events.length + 2);
  expect(result.every((value, index) => value.checkpoint === index - 1)).toBe(
    true,
  );
});
