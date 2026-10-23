import { assert } from "./assert.js";

export const chunk = <T>(array: T[], size: number): T[][] => {
  // Note: `size < 1` would loop forever.
  if (__DEBUG__) {
    assert(
      Number.isInteger(size) && size >= 1,
      () => `Expected a positive integer chunk size, got ${size}`,
    );
  }

  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
};
