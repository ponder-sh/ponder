/**
 * Return the union of a list of numeric intervals.
 *
 * @param intervals List of numeric intervals to find the union of.
 * @returns Union of the intervals, represented as a list of intervals.
 */
export function intervalUnion(intervals: [number, number][]) {
  if (intervals.length === 0) return [];

  // Sort intervals based on the left end
  intervals.sort((a, b) => a[0] - b[0]);

  const result: [number, number][] = [];
  let currentInterval = intervals[0];

  for (let i = 1; i < intervals.length; i++) {
    const nextInterval = intervals[i];

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
  list1: [number, number][],
  list2: [number, number][]
) {
  const result: [number, number][] = [];
  let i = 0;
  let j = 0;

  while (i < list1.length && j < list2.length) {
    const [start1, end1] = list1[i];
    const [start2, end2] = list2[j];

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
 * @returns Difference of the intervals, represented as a list of intervals.
 */
export function intervalIntersectionMany(lists: [number, number][][]) {
  if (lists.length === 0) return [];
  if (lists.length === 1) return lists[0];

  let result: [number, number][] = lists[0];

  for (let i = 1; i < lists.length; i++) {
    result = intervalIntersection(result, lists[i]);
  }

  return intervalUnion(result);
}

/**
 * Return the difference between two lists of numeric intervals (list1 - list2).
 *
 * @param list1 First list of numeric intervals.
 * @param list2 Second list of numeric intervals.
 * @returns Difference of the intervals, represented as a list of intervals.
 */
export function intervalDifference(
  list1: [number, number][],
  list2: [number, number][]
) {
  const result: [number, number][] = [];

  let i = 0;
  let j = 0;

  while (i < list1.length && j < list2.length) {
    const interval1 = list1[i];
    const interval2 = list2[j];

    if (interval1[1] < interval2[0]) {
      // No overlap, add interval1 to the result
      result.push(interval1);
      i++;
    } else if (interval2[1] < interval1[0]) {
      // No overlap, move to the next interval in list2
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
        // No more overlap, move to the next interval in list1
        i++;
      }
    }
  }

  // Add any remaining intervals from list1
  while (i < list1.length) {
    result.push(list1[i]);
    i++;
  }

  return result;
}
