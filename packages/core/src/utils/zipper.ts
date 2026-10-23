import { assert } from "./assert.js";

/** Returns the index of the first element of `array` that is less than the previous one, or -1. */
const findUnsorted = <T>(array: T[], compare?: (a: T, b: T) => number) => {
  for (let i = 1; i < array.length; i++) {
    if (
      compare
        ? compare(array[i - 1]!, array[i]!) > 0
        : array[i]! < array[i - 1]!
    ) {
      return i;
    }
  }
  return -1;
};

/**
 * Merges two sorted arrays into a single sorted array.
 *
 * @param array1 - The first array to merge.
 * @param array2 - The second array to merge.
 * @param compare - The comparison function to use.
 *
 * @returns The merged array.
 *
 * @example
 * ```ts
 * const result = zipper([1, 3, 5], [2, 4, 6]);
 * // result = [1, 2, 3, 4, 5, 6]
 * ```
 */
export const zipper = <T>(
  array1: T[],
  array2: T[],
  compare?: (a: T, b: T) => number,
): T[] => {
  if (__DEBUG__) {
    for (const array of [array1, array2]) {
      const i = findUnsorted(array, compare);
      assert(
        i === -1,
        () =>
          `Expected sorted input, got ${String(array[i - 1])} followed by ${String(array[i])} at index ${i}`,
      );
    }
  }

  const result: T[] = [];
  let i = 0;
  let j = 0;

  while (i < array1.length && j < array2.length) {
    if (
      compare ? compare(array1[i]!, array2[j]!) < 0 : array1[i]! < array2[j]!
    ) {
      result.push(array1[i]!);
      i++;
    } else {
      result.push(array2[j]!);
      j++;
    }
  }

  if (i < array1.length) {
    result.push(...array1.slice(i));
  }

  if (j < array2.length) {
    result.push(...array2.slice(j));
  }

  return result;
};

/**
 * Merges many sorted arrays into a single sorted array.
 *
 * @param arrays - The arrays to merge.
 * @param compare - The comparison function to use.
 *
 * @returns The merged array.
 *
 * @example
 * ```ts
 * const result = zipperMany([
 *   [1, 3, 5],
 *   [2, 4, 6],
 *   [7, 8, 9],
 * ]);
 * // result = [1, 2, 3, 4, 5, 6, 7, 8, 9]
 * ```
 */
export const zipperMany = <T>(
  arrays: T[][],
  compare?: (a: T, b: T) => number,
): T[] => {
  if (arrays.length === 0) return [];
  if (arrays.length === 1) return arrays[0]!;

  let result: T[] = arrays[0]!;

  for (let i = 1; i < arrays.length; i++) {
    result = zipper(result, arrays[i]!, compare);
  }

  return result;
};
