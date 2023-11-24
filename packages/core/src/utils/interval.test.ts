import { expect, test } from "vitest";

import {
  BlockProgressTracker,
  getChunks,
  intervalDifference,
  intervalIntersection,
  intervalSum,
  intervalUnion,
  ProgressTracker,
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

test("ProgressTracker constructor initializes correctly", () => {
  const tracker = new ProgressTracker({ target: [3, 10], completed: [] });

  expect(tracker.getRequired()).toEqual([[3, 10]]);
  expect(tracker.getCheckpoint()).toEqual(2);
});

test("ProgressTracker constructor throws if passed an invalid interval", () => {
  expect(
    () => new ProgressTracker({ target: [10, 1], completed: [] }),
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
    "Invalid interval: start (5) is greater than end (3)",
  );
});

test("ProgressTracker returns correct checkpoint with multiple completed", () => {
  const tracker = new ProgressTracker({
    target: [5, 15],
    completed: [
      [1, 3],
      [5, 7],
    ],
  });
  expect(tracker.getCheckpoint()).toEqual(7);
});

test("ProgressTracker getRequired does not change checkpoint", () => {
  const tracker = new ProgressTracker({
    target: [6, 17],
    completed: [
      [0, 10],
      [12, 15],
    ],
  });
  expect(tracker.getCheckpoint()).toEqual(10);
  expect(tracker.getRequired()).toEqual([
    [11, 11],
    [16, 17],
  ]);
  expect(tracker.getCheckpoint()).toEqual(10);
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

test("BlockProgressTracker returns null checkpoint until first pending block is completed", () => {
  const tracker = new BlockProgressTracker();
  tracker.addPendingBlocks({ blockNumbers: [5, 6, 9, 10] });

  let checkpoint = tracker.addCompletedBlock({
    blockNumber: 6,
    blockTimestamp: 100,
  });
  expect(checkpoint).toBe(null);

  checkpoint = tracker.addCompletedBlock({
    blockNumber: 9,
    blockTimestamp: 110,
  });
  expect(checkpoint).toBe(null);
});

test("BlockProgressTracker returns null until first pending block is completed", () => {
  const tracker = new BlockProgressTracker();
  tracker.addPendingBlocks({ blockNumbers: [5, 6, 9, 10] });

  let checkpoint = tracker.addCompletedBlock({
    blockNumber: 6,
    blockTimestamp: 100,
  });
  expect(checkpoint).toBe(null);

  checkpoint = tracker.addCompletedBlock({
    blockNumber: 9,
    blockTimestamp: 110,
  });
  expect(checkpoint).toBe(null);
});

test("BlockProgressTracker tracks minimum continuous completed checkpoint", () => {
  const tracker = new BlockProgressTracker();
  tracker.addPendingBlocks({ blockNumbers: [5, 6, 9, 10] });

  let newCheckpoint = tracker.addCompletedBlock({
    blockNumber: 6,
    blockTimestamp: 100,
  });
  expect(newCheckpoint).toBe(null);

  newCheckpoint = tracker.addCompletedBlock({
    blockNumber: 5,
    blockTimestamp: 98,
  });
  expect(newCheckpoint).toMatchObject({ blockNumber: 6, blockTimestamp: 100 });

  newCheckpoint = tracker.addCompletedBlock({
    blockNumber: 10,
    blockTimestamp: 120,
  });
  expect(newCheckpoint).toBe(null); // Null because the checkpoint has not progressed.

  newCheckpoint = tracker.addCompletedBlock({
    blockNumber: 9,
    blockTimestamp: 110,
  });
  expect(newCheckpoint).toMatchObject({ blockNumber: 10, blockTimestamp: 120 });
});

test("BlockProgressTracker returns null if there is no new checkpoint", () => {
  const tracker = new BlockProgressTracker();
  tracker.addPendingBlocks({ blockNumbers: [5, 6, 9, 10] });

  let newCheckpoint = tracker.addCompletedBlock({
    blockNumber: 6,
    blockTimestamp: 100,
  });
  expect(newCheckpoint).toBe(null);

  newCheckpoint = tracker.addCompletedBlock({
    blockNumber: 9,
    blockTimestamp: 110,
  });
  expect(newCheckpoint).toBe(null);

  newCheckpoint = tracker.addCompletedBlock({
    blockNumber: 5,
    blockTimestamp: 98,
  });
  expect(newCheckpoint).toMatchObject({ blockNumber: 9, blockTimestamp: 110 });
});

test("BlockProgressTracker returns new checkpoint if first completed block is first pending block", () => {
  const tracker = new BlockProgressTracker();
  tracker.addPendingBlocks({ blockNumbers: [5, 6, 9, 10] });

  const newCheckpoint = tracker.addCompletedBlock({
    blockNumber: 5,
    blockTimestamp: 98,
  });
  expect(newCheckpoint).toMatchObject({ blockNumber: 5, blockTimestamp: 98 });
});

test("BlockProgressTracker handles multiple batches of pending blocks", () => {
  const tracker = new BlockProgressTracker();
  tracker.addPendingBlocks({ blockNumbers: [5, 6, 10] });

  let newCheckpoint = tracker.addCompletedBlock({
    blockNumber: 6,
    blockTimestamp: 100,
  });
  expect(newCheckpoint).toBe(null);
  expect(tracker.checkpoint).toBe(null);

  newCheckpoint = tracker.addCompletedBlock({
    blockNumber: 5,
    blockTimestamp: 98,
  });
  expect(newCheckpoint).toMatchObject({ blockNumber: 6, blockTimestamp: 100 });
  expect(tracker.checkpoint).toMatchObject({
    blockNumber: 6,
    blockTimestamp: 100,
  });

  tracker.addPendingBlocks({ blockNumbers: [11, 12, 15] });

  newCheckpoint = tracker.addCompletedBlock({
    blockNumber: 11,
    blockTimestamp: 115,
  });
  expect(newCheckpoint).toBe(null);
  expect(tracker.checkpoint).toMatchObject({
    blockNumber: 6,
    blockTimestamp: 100,
  });

  newCheckpoint = tracker.addCompletedBlock({
    blockNumber: 12,
    blockTimestamp: 120,
  });
  expect(newCheckpoint).toBe(null);
  expect(tracker.checkpoint).toMatchObject({
    blockNumber: 6,
    blockTimestamp: 100,
  });

  newCheckpoint = tracker.addCompletedBlock({
    blockNumber: 10,
    blockTimestamp: 120,
  });
  expect(newCheckpoint).toMatchObject({ blockNumber: 12, blockTimestamp: 120 });
  expect(tracker.checkpoint).toMatchObject({
    blockNumber: 12,
    blockTimestamp: 120,
  });
});

test("BlockProgressTracker throws if pending blocks are added out of order", () => {
  const tracker = new BlockProgressTracker();

  tracker.addPendingBlocks({ blockNumbers: [5, 6, 9, 10] });

  expect(() =>
    tracker.addPendingBlocks({ blockNumbers: [8, 12] }),
  ).toThrowError(
    "New pending block number 8 was added out of order. Already added block number 10.",
  );
});

test("BlockProgressTracker throws if completed block was not pending", () => {
  const tracker = new BlockProgressTracker();

  expect(() =>
    tracker.addCompletedBlock({ blockNumber: 5, blockTimestamp: 98 }),
  ).toThrowError(
    "Block number 5 was not pending. Ensure to add blocks as pending before marking them as completed.",
  );
});
