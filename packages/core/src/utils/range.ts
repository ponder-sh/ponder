// Generates an array of integers between two bounds. Exclusive on the right.
export const range = (start: number, stop: number) =>
  Array.from({ length: stop - start }, (_, i) => start + i);
