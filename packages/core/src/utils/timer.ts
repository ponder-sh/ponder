/**
 * Measures the elapsed wall clock time in milliseconds (ms) between two points.
 * @returns A function returning the elapsed time in milliseconds (ms).
 */
export function startClock() {
  const start = performance.now();
  return () => performance.now() - start;
}
