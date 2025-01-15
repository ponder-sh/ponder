/**
 * Divides an array into two arrays, where the first array
 * contains all elements that satisfy the predicate, and the
 * second array contains all elements that do not satisfy the
 * predicate.
 *
 * Note: It is assumed that the array is sorted.
 *
 * @param array - The array to partition.
 * @param predicate - The predicate to partition the array by.
 *
 * @returns A tuple containing the left and right arrays.
 *
 * @example
 * ```ts
 * const [left, right] = partition([1, 2, 3, 4, 5], (n) => n <= 2);
 * // left = [1, 2]
 * // right = [3, 4, 5]
 * ```
 */
export const partition = <T>(
  array: T[],
  predicate: (item: T) => boolean,
): [T[], T[]] => {
  let low = 0;
  let high = array.length;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (predicate(array[mid]!)) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  const left = array.slice(0, low);
  const right = array.slice(low);

  return [left, right];
};
