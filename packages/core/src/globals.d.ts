/**
 * Compile-time flag for debug assertions. `true` in tests and when running
 * source directly, replaced with `false` by the published build so that
 * `if (__DEBUG__) { ... }` blocks are removed.
 *
 * @see ./utils/assert.ts
 */
declare const __DEBUG__: boolean;
