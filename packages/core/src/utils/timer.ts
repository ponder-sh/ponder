export const startBenchmark = () => process.hrtime();
export const endBenchmark = (hrt: [number, number]) => {
  const diffHrt = process.hrtime(hrt);
  return Math.round(diffHrt[0] * 1000 + diffHrt[1] / 1000000);
};
