/**
 * Assert that a condition is true. In debug mode (PONDER_DEBUG=true),
 * throws an error if the condition is false. In production, this is a no-op
 * unless `alwaysThrow` is set to true.
 *
 * Use this to validate internal assumptions that should always hold.
 * These are NOT for user input validation - use proper error types for that.
 */
export function invariant(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) {
    if (process.env.PONDER_DEBUG === "true") {
      throw new Error(`Invariant violation: ${message}`);
    }
  }
}

/**
 * Like `invariant()`, but always throws regardless of PONDER_DEBUG.
 * Use for conditions that indicate a critical bug if violated.
 */
export function hardInvariant(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) {
    throw new Error(`Invariant violation: ${message}`);
  }
}
