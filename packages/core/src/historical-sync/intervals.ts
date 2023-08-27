// These methods are used in the cached interval calculations
// From https://stackoverflow.com/a/33857786/12841788

/**
 * Removes duplicate elements from an array.
 */
function removeDuplicates(arr: [number, number][]) {
  const lookup: Record<string, number> = {};
  const results = [];
  for (let i = 0; i < arr.length; i++) {
    const el = arr[i];
    const key = el.toString();
    if (lookup[key]) continue;
    lookup[key] = 1;
    results.push(el);
  }
  return results;
}

/**
 * Given an interval and an interval to exclude, return an array of
 * remaining intervals.
 *
 * ```ts
 * removeIntervalFromInterval([1,7], [4,5])
 * // [[1,3],[6,7]]
 * ```
 */
function removeIntervalFromInterval(
  interval: [number, number],
  intervalToExclude: [number, number]
) {
  if (interval[1] < intervalToExclude[0]) return [interval]; // interval finishes before intervalToExclude starts
  if (interval[0] > intervalToExclude[1]) return [interval]; // interval starts after intervalToExclude ends
  const intervals = [];
  // calculate interval before intervalToExclude starts
  const line1 = [interval[0], Math.min(interval[1], intervalToExclude[0] - 1)];
  if (line1[0] <= line1[1]) intervals.push(line1);
  // calculate interval after intervalToExclude ends
  const line2 = [intervalToExclude[1] + 1, interval[1]];
  if (line2[0] <= line2[1]) intervals.push(line2);
  return intervals as [number, number][];
}

/**
 * Given a list of intervals and one exclusion interval,
 * return the remaining intervals.
 *
 * ```ts
 * removeIntervalFromIntervals([[1,7],[0,1]], [4,5])
 * // [[0,1],[1,3],[6,7]]
 * ```
 */
function removeIntervalFromIntervals(
  intervals: [number, number][],
  intervalToExclude: [number, number]
) {
  const results: [number, number][] = [];
  for (let i = 0; i < intervals.length; i++) {
    results.push(
      ...removeIntervalFromInterval(intervals[i], intervalToExclude)
    );
  }
  return results;
}

/**
 * Given one interval and a list of exclusion intervals,
 * return the remaining intervals.
 */
export function removeIntervalsFromInterval(
  interval: [number, number],
  intervalsToExclude: [number, number][]
) {
  let checking = [interval];
  for (let i = 0; i < intervalsToExclude.length; i++) {
    checking = removeIntervalFromIntervals(checking, intervalsToExclude[i]);
  }
  return removeDuplicates(checking);
}

/**
 * Given a list of intervals and a list of exclusion intervals,
 * return the remaining intervals.
 *
 * ```ts
 * removeIntervalsFromIntervals([[3,9],[0,2]], [[4,5],[0,1]])
 * // [[1,2],[3,4],[6,9]]
 * ```
 */
export function removeIntervalsFromIntervals(
  intervals: [number, number][],
  intervalsToExclude: [number, number][]
) {
  let remainingIntervals: [number, number][] = intervals;

  for (let i = 0; i < intervalsToExclude.length; i++) {
    const intervalToExclude = intervalsToExclude[i];
    const newRemainingIntervals: [number, number][] = [];

    for (let j = 0; j < remainingIntervals.length; j++) {
      const interval = remainingIntervals[j];
      newRemainingIntervals.push(
        ...removeIntervalFromInterval(interval, intervalToExclude)
      );
    }

    remainingIntervals = newRemainingIntervals;
  }

  return removeDuplicates(remainingIntervals);
}
