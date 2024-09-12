import { expect, test } from "vitest";
import {
  getChunks,
  intervalDifference,
  intervalIntersection,
  intervalSum,
  intervalUnion,
  sortIntervals,
} from "./interval.js";

test("intervalSum handles empty input", () => {
  const result = intervalSum([]);
  expect(result).toEqual(0);
});

test("intervalSum calculates the sum of intervals", () => {
  const result = intervalSum([
    [1, 3],
    [5, 7],
    [10, 12],
  ]);
  expect(result).toEqual(9);
});

test("intervalSum calculates the sum of single-point intervals", () => {
  const result = intervalSum([
    [1, 1],
    [3, 3],
    [5, 5],
  ]);
  expect(result).toEqual(3);
});

test("intervalUnion handles empty input", () => {
  const result = intervalUnion([]);
  expect(result).toEqual([]);
});

test("intervalUnion merges overlapping intervals", () => {
  const result = intervalUnion([
    [1, 3],
    [2, 4],
    [6, 7],
  ]);
  expect(result).toEqual([
    [1, 4],
    [6, 7],
  ]);
});

test("intervalUnion merges adjacent intervals", () => {
  const result = intervalUnion([
    [1, 3],
    [4, 5],
    [6, 6],
  ]);
  expect(result).toEqual([[1, 6]]);
});

test("intervalUnion handles non-overlapping intervals", () => {
  const result = intervalUnion([
    [1, 3],
    [5, 7],
    [9, 12],
  ]);
  expect(result).toEqual([
    [1, 3],
    [5, 7],
    [9, 12],
  ]);
});

test("intervalUnion removes duplicate intervals", () => {
  const result = intervalUnion([
    [1, 3],
    [1, 3],
    [2, 6],
    [1, 3],
  ]);
  expect(result).toEqual([[1, 6]]);
});

test("intervalUnion does not mutate inputs", () => {
  const intervals = [
    [3, 5],
    [1, 2],
    [4, 6],
  ] satisfies [number, number][];
  const originalIntervals = JSON.parse(JSON.stringify(intervals));

  intervalUnion(intervals);

  // Asserting that the original intervals array has not been modified
  expect(intervals).toEqual(originalIntervals);
});

test("intervalIntersection handles empty input", () => {
  const result = intervalIntersection([], []);
  expect(result).toEqual([]);
});

test("intervalIntersection correctly finds intersections", () => {
  const result = intervalIntersection(
    [
      [1, 5],
      [3, 7],
      [9, 12],
    ],
    [
      [2, 4],
      [4, 6],
      [10, 11],
    ],
  );
  expect(result).toEqual([
    [2, 6],
    [10, 11],
  ]);
});

test("intervalIntersection handles no intersections", () => {
  const result = intervalIntersection(
    [
      [1, 3],
      [5, 7],
      [9, 12],
    ],
    [
      [4, 4],
      [8, 8],
    ],
  );
  expect(result).toEqual([]);
});

test("intervalDifference handles empty inputs", () => {
  const result = intervalDifference([], []);
  expect(result).toEqual([]);
});

test("intervalDifference correctly finds differences", () => {
  const result = intervalDifference(
    [
      [1, 5],
      [7, 10],
    ],
    [
      [2, 4],
      [8, 10],
    ],
  );

  expect(result).toEqual([
    [1, 1],
    [5, 5],
    [7, 7],
  ]);
});

test("intervalDifference handles no difference", () => {
  const result = intervalDifference(
    [
      [1, 3],
      [5, 7],
    ],
    [
      [0, 0],
      [4, 4],
    ],
  );
  expect(result).toEqual([
    [1, 3],
    [5, 7],
  ]);
});

test("intervalDifference handles full difference", () => {
  const result = intervalDifference(
    [
      [1, 5],
      [4, 7],
    ],
    [[0, 8]],
  );
  expect(result).toEqual([]);
});

test("intervalDifference does not mutate inputs", () => {
  const initial = [6, 17] satisfies [number, number];
  const remove = [
    [0, 10],
    [12, 15],
  ] satisfies [number, number][];

  intervalDifference([initial], remove);

  expect(initial).toStrictEqual([6, 17]);
});

test("sortIntervals", () => {
  let result = sortIntervals([
    [1, 5],
    [4, 7],
  ]);
  expect(result).toStrictEqual([
    [1, 5],
    [4, 7],
  ]);

  result = sortIntervals([
    [4, 7],
    [1, 5],
  ]);
  expect(result).toStrictEqual([
    [1, 5],
    [4, 7],
  ]);
});

test("getChunks", () => {
  const result = getChunks({ interval: [1, 9], maxChunkSize: 2 });

  expect(result).toStrictEqual([
    [1, 2],
    [3, 4],
    [5, 6],
    [7, 8],
    [9, 9],
  ]);
});
