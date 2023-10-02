import { expect, test } from "vitest";

import {
  getChunks,
  intervalDifference,
  intervalIntersection,
  intervalUnion,
  ProgressTracker,
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

test("ProgressTracker constructor initializes correctly", () => {
  const tracker = new ProgressTracker({ target: [3, 10], completed: [] });

  expect(tracker.getRequired()).toEqual([[3, 10]]);
  expect(tracker.getCheckpoint()).toEqual(2);
});

test("ProgressTracker constructor throws if passed an invalid interval", () => {
  expect(
    () => new ProgressTracker({ target: [10, 1], completed: [] })
  ).toThrowError("Invalid interval: start (10) is greater than end (1)");
});

test("ProgressTracker addCompletedInterval updates required and checkpoint", () => {
  const tracker = new ProgressTracker({ target: [1, 10], completed: [] });
  tracker.addCompletedInterval([1, 5]);

  expect(tracker.getRequired()).toEqual([[6, 10]]);
  expect(tracker.getCheckpoint()).toEqual(5);
});

test("ProgressTracker addCompletedInterval handles overlapping completed intervals", () => {
  const tracker = new ProgressTracker({ target: [1, 10], completed: [[1, 3]] });
  tracker.addCompletedInterval([2, 6]);

  expect(tracker.getRequired()).toEqual([[7, 10]]);
  expect(tracker.getCheckpoint()).toEqual(6);
});

test("ProgressTracker addCompletedInterval handles non-overlapping completed intervals", () => {
  const tracker = new ProgressTracker({ target: [1, 10], completed: [[1, 3]] });
  tracker.addCompletedInterval([5, 6]);

  expect(tracker.getRequired()).toEqual([
    [4, 4],
    [7, 10],
  ]);
  expect(tracker.getCheckpoint()).toEqual(3);
});

test("ProgressTracker addCompletedInterval constructor throws if passed an invalid interval", () => {
  const tracker = new ProgressTracker({ target: [1, 10], completed: [] });

  expect(() => tracker.addCompletedInterval([5, 3])).toThrowError(
    "Invalid interval: start (5) is greater than end (3)"
  );
});

test("ProgressTracker returns correct checkpoint", () => {
  const tracker = new ProgressTracker({
    target: [5, 15],
    completed: [
      [1, 3],
      [5, 7],
    ],
  });
  expect(tracker.getCheckpoint()).toEqual(7);
});

test("getChunks splits intervals correctly", () => {
  const intervals = [[1, 10]] satisfies [number, number][];
  const chunks = getChunks({ intervals, maxChunkSize: 3 });
  expect(chunks).toEqual([
    [1, 3],
    [4, 6],
    [7, 9],
    [10, 10],
  ]);
});

test("getChunks handles multiple intervals", () => {
  const intervals = [
    [1, 5],
    [7, 10],
  ] satisfies [number, number][];
  const chunks = getChunks({ intervals, maxChunkSize: 4 });
  expect(chunks).toEqual([
    [1, 4],
    [5, 5],
    [7, 10],
  ]);
});
