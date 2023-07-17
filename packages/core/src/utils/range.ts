/**
 * Generates an array of integers between two bounds. Exclusive on the right.
 *
 * @param start Integer to start at.
 * @param stop Integer to stop at (exclusive).
 */
export const range = (start: number, stop: number) =>
  Array.from({ length: stop - start }, (_, i) => start + i);
