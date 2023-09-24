import { expect, test } from "vitest";

import {
  intervalDifference,
  intervalIntersection,
  intervalUnion,
} from "./interval";

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
    ]
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
    ]
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
    ]
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
    ]
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
    [[0, 8]]
  );
  expect(result).toEqual([]);
});
