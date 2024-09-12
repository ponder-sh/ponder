export const estimate = ({
  from,
  to,
  target,
  result,
  min,
  max,
  prev,
  maxIncrease,
}: {
  from: number;
  to: number;
  target: number;
  result: number;
  min: number;
  max: number;
  prev: number;
  maxIncrease: number;
}) => {
  const density = (to - from) / (result || 1);
  // min <= estimate <= prev * maxIncrease or max
  return Math.min(
    Math.max(min, Math.round(target * density)),
    Math.round(prev * maxIncrease),
    max,
  );
};
