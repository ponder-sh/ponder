/**
 * Measures the elapsed wall clock time in milliseconds (ms) between two points.
 * @returns A function returning the elapsed time in milliseconds (ms).
 */
export function startClock() {
  const start = process.hrtime();
  return () => hrTimeToMs(process.hrtime(start));
}

/**
 * Converts a process.hrtime() measurement to milliseconds (ms).
 * @returns The timestamp in milliseconds (ms).
 */
export function hrTimeToMs(diff: [number, number]) {
  const ns = diff[0] * 10 ** 9 + diff[1];
  return ns / 10 ** 6;
}
