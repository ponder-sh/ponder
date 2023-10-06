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
  return Math.round(diff[0] * 1000 + diff[1] / 1000000);
}

export function sleep(ms: number): void {
  /**
   * In some environments such as Cloudflare Workers, Atomics is not defined
   * setTimeout is used as a fallback
   */
  if (typeof Atomics === "undefined") {
    new Promise((resolve) => setTimeout(resolve, ms));
  } else {
    const AB = new Int32Array(new SharedArrayBuffer(4));
    Atomics.wait(AB, 0, 0, Math.max(1, ms | 0));
  }
}
