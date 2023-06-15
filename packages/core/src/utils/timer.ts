/**
 * Measures the elapsed wall clock time in milliseconds (ms) between two points.
 * @returns A function returning the elapsed time in milliseconds (ms).
 */
export const startClock = () => {
  const start = process.hrtime();

  return () => {
    const diff = process.hrtime(start);
    return Math.round(diff[0] * 1000 + diff[1] / 1000000);
  };
};
