import { assert } from "./assert.js";
import { range } from "./range.js";

export type Interval = [number, number];

/**
 * Returns the index of the first interval in `intervals` that is malformed (`start > end`)
 * or out of order, or -1 if there is none.
 *
 * @param isMerged If false, intervals must be sorted by start. If true, intervals must also
 * be disjoint and non-adjacent, like the result of {@link intervalUnion}.
 */
export function findUnsortedInterval(
  intervals: Interval[],
  isMerged: boolean,
): number {
  for (let i = 0; i < intervals.length; i++) {
    const [start, end] = intervals[i]!;
    if (start > end) return i;
    if (i === 0) continue;
    const previous = intervals[i - 1]!;
    if (isMerged ? previous[1] + 1 >= start : previous[0] > start) return i;
  }
  return -1;
}

const assertSortedIntervals = (
  intervals: Interval[],
  isMerged: boolean,
  label: string,
) => {
  const i = findUnsortedInterval(intervals, isMerged);
  assert(
    i === -1,
    () =>
      `Expected ${label} to be ${isMerged ? "merged" : "sorted"}, got ${JSON.stringify(intervals[i - 1])} followed by ${JSON.stringify(intervals[i])} at index ${i}`,
  );
};

/**
 * Return the total sum of a list of numeric intervals.
 *
 * @param intervals List of numeric intervals to find the sum of.
 * @returns Sum of the intervals.
 */
export function intervalSum(intervals: Interval[]) {
  let totalSum = 0;

  for (const [start, end] of intervals) {
    totalSum += end - start + 1;
  }

  return totalSum;
}

/**
 * Return the union of a list of numeric intervals.
 *
 * @param intervals List of numeric intervals to find the union of.
 * @returns Union of the intervals, represented as a list of intervals.
 */
export function intervalUnion(intervals_: Interval[]) {
  if (intervals_.length === 0) return [];

  if (__DEBUG__) {
    for (const interval of intervals_) {
      assert(
        interval[0] <= interval[1],
        () => `Expected interval start <= end, got ${JSON.stringify(interval)}`,
      );
    }
  }

  // Create copies to avoid mutating the originals.
  const intervals = intervals_.map((interval) => [...interval] as Interval);
  // Sort intervals based on the left end.
  intervals.sort((a, b) => a[0] - b[0]);

  const result: Interval[] = [];
  let currentInterval = intervals[0]!;

  for (let i = 1; i < intervals.length; i++) {
    const nextInterval = intervals[i]!;

    if (currentInterval[1] >= nextInterval[0] - 1) {
      // Merge overlapping intervals
      currentInterval[1] = Math.max(currentInterval[1], nextInterval[1]);
    } else {
      // No overlap, add current interval to result
      result.push(currentInterval);
      currentInterval = nextInterval;
    }
  }

  result.push(currentInterval); // Add the last interval

  if (__DEBUG__) assertSortedIntervals(result, true, "union");

  return result;
}

/**
 * Return the intersection of two lists of numeric intervals.
 *
 * @param list1 First list of numeric intervals.
 * @param list2 Second list of numeric intervals.
 * @returns Intersection of the intervals, represented as a list of intervals.
 */
export function intervalIntersection(
  list1: Interval[],
  list2: Interval[],
): Interval[] {
  // Note: The two pointer walk below requires inputs sorted by start.
  if (__DEBUG__) {
    assertSortedIntervals(list1, false, "intersection input");
    assertSortedIntervals(list2, false, "intersection input");
  }

  const result: Interval[] = [];
  let i = 0;
  let j = 0;

  while (i < list1.length && j < list2.length) {
    const [start1, end1] = list1[i]!;
    const [start2, end2] = list2[j]!;

    const intersectionStart = Math.max(start1, start2);
    const intersectionEnd = Math.min(end1, end2);

    if (intersectionStart <= intersectionEnd) {
      result.push([intersectionStart, intersectionEnd]);
    }

    if (end1 < end2) {
      i++;
    } else {
      j++;
    }
  }

  // Merge potentially overlapping intervals before returning.
  return intervalUnion(result);
}

/**
 * Return the intersection of many lists of numeric intervals.
 *
 * @param list1 First list of numeric intervals.
 * @param list2 Second list of numeric intervals.
 * @returns Intersection of the intervals, represented as a list of intervals.
 */
export function intervalIntersectionMany(lists: Interval[][]): Interval[] {
  if (lists.length === 0) return [];
  if (lists.length === 1) return lists[0]!;

  let result: Interval[] = lists[0]!;

  for (let i = 1; i < lists.length; i++) {
    result = intervalIntersection(result, lists[i]!);
  }

  return intervalUnion(result);
}

/**
 * Return the difference between two lists of numeric intervals (initial - remove).
 *
 * @param initial Starting/base list of numeric intervals.
 * @param remove List of numeric intervals to remove.
 * @returns Difference of the intervals, represented as a list of intervals.
 */
export function intervalDifference(
  initial: Interval[],
  remove: Interval[],
): Interval[] {
  // Note: The two pointer walk below requires inputs sorted by start.
  if (__DEBUG__) {
    assertSortedIntervals(initial, false, "difference input");
    assertSortedIntervals(remove, false, "difference input");
  }

  // Create copies to avoid mutating the originals.
  const initial_ = initial.map((interval) => [...interval] as Interval);
  const remove_ = remove.map((interval) => [...interval] as Interval);

  const result: Interval[] = [];

  let i = 0;
  let j = 0;

  while (i < initial.length && j < remove.length) {
    const interval1 = initial_[i]!;
    const interval2 = remove_[j]!;

    if (interval1[1] < interval2[0]) {
      // No overlap, add interval1 to the result
      result.push(interval1);
      i++;
    } else if (interval2[1] < interval1[0]) {
      // No overlap, move to the next interval in remove
      j++;
    } else {
      // There is an overlap
      if (interval1[0] < interval2[0]) {
        // Add the left part of interval1
        result.push([interval1[0], interval2[0] - 1]);
      }
      if (interval1[1] > interval2[1]) {
        // Update interval1's start to exclude the overlap
        interval1[0] = interval2[1] + 1;
        j++;
      } else {
        // No more overlap, move to the next interval in initial
        i++;
      }
    }
  }

  // Add any remaining intervals from initial
  while (i < initial_.length) {
    result.push(initial_[i]!);
    i++;
  }

  if (__DEBUG__) {
    assertSortedIntervals(result, false, "difference");
    const initialUnion = intervalUnion(initial);
    const expectedSum =
      intervalSum(initialUnion) -
      intervalSum(intervalIntersection(initialUnion, intervalUnion(remove)));
    assert(
      intervalSum(intervalUnion(result)) === expectedSum,
      () =>
        `Expected difference of ${JSON.stringify(initial)} and ${JSON.stringify(remove)} to contain ${expectedSum} blocks, got ${JSON.stringify(result)}`,
    );
  }

  return result;
}

/**
 * Return an interval that encompasses all the intervals in the list.
 *
 * @param intervals List of numeric intervals to find the bounds of.
 * @returns Bounds of the intervals.
 */
export function intervalBounds(intervals: Interval[]): Interval {
  if (__DEBUG__) {
    assert(intervals.length > 0, "Expected at least one interval for bounds");
  }

  const start = Math.min(...intervals.map((interval) => interval[0]));
  const end = Math.max(...intervals.map((interval) => interval[1]));

  return [start, end];
}

export function sortIntervals(intervals: Interval[]) {
  return intervals.sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

export function getChunks({
  interval,
  maxChunkSize,
}: {
  interval: Interval;
  maxChunkSize: number;
}) {
  // Note: `maxChunkSize < 1` would loop forever.
  if (__DEBUG__) {
    assert(
      Number.isInteger(maxChunkSize) && maxChunkSize >= 1,
      () => `Expected a positive integer chunk size, got ${maxChunkSize}`,
    );
  }

  const _chunks: Interval[] = [];

  const [startBlock, endBlock] = interval;

  let fromBlock = startBlock;
  let toBlock = Math.min(fromBlock + maxChunkSize - 1, endBlock);

  while (fromBlock <= endBlock) {
    _chunks.push([fromBlock, toBlock]);

    fromBlock = toBlock + 1;
    toBlock = Math.min(fromBlock + maxChunkSize - 1, endBlock);
  }

  return _chunks;
}

export function intervalRange(interval: Interval) {
  return range(interval[0], interval[1] + 1);
}
