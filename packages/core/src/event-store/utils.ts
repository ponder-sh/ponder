/* This function merges intervals (inclusive on both ends).
 * I modified the SO impl to handle [inclusive, inclusive] intervals.
 * From: https://stackoverflow.com/a/26391774/12841788
 */
export function merge_intervals(intervals: number[][]) {
  intervals.sort((a, b) => a[0] - b[0]);
  const result: number[][] = [];
  let last: number[];
  intervals.forEach((interval) => {
    if (interval[1] < interval[0])
      throw new Error(`Cannot merge invalid interval: ${interval}`);
    interval = [interval[0], interval[1] + 1];
    if (!last || interval[0] > last[1]) {
      result.push((last = interval));
    } else if (interval[1] > last[1]) {
      last[1] = interval[1];
    }
  });
  return result.map((r) => [r[0], r[1] - 1]);
}
