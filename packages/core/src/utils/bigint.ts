/**
 * Returns the minimum BigInt value from an array of BigInts.
 *
 * @param {bigint[]} values - An array of BigInt values.
 * @returns {bigint} The minimum BigInt value from the array.
 */
export function bigIntMin(values: bigint[]): bigint {
  if (values.length === 0) {
    throw new Error("Input array must not be empty.");
  }

  let minVal: bigint = values[0]!;
  for (let i = 1; i < values.length; i++) {
    if (values[i]! < minVal) {
      minVal = values[i]!;
    }
  }

  return minVal;
}

/**
 * Returns the maximum BigInt value from an array of BigInts.
 *
 * @param {bigint[]} values - An array of BigInt values.
 * @returns {bigint} The maximum BigInt value from the array.
 */
export function bigIntMax(values: bigint[]): bigint {
  if (values.length === 0) {
    throw new Error("Input array must not be empty.");
  }

  let maxVal: bigint = values[0]!;
  for (let i = 1; i < values.length; i++) {
    if (values[i]! > maxVal) {
      maxVal = values[i]!;
    }
  }

  return maxVal;
}
