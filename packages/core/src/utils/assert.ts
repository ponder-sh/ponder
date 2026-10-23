/**
 * Error thrown when an internal invariant is violated. Indicates a bug in Ponder,
 * not a user error.
 */
export class AssertionError extends Error {
  override name = "AssertionError";
}

/**
 * Throw an {@link AssertionError} if `condition` is falsy.
 *
 * Only call this inside an `if (__DEBUG__)` block. The published build replaces
 * `__DEBUG__` with `false` and removes the block, so assertions cost nothing in
 * production.
 *
 * @param message Message or lazy message builder, only evaluated on failure.
 *
 * @example
 * if (__DEBUG__) assert(a <= b, () => `Expected ${a} <= ${b}`);
 */
export function assert(
  condition: unknown,
  message: string | (() => string),
): asserts condition {
  if (!condition) {
    throw new AssertionError(
      typeof message === "function" ? message() : message,
    );
  }
}
