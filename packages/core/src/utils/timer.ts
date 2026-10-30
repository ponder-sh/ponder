import { Clock, Effect } from "effect";

/**
 * Measures the elapsed wall clock time in milliseconds (ms) between two points.
 * @returns A function returning the elapsed time in milliseconds (ms).
 */
export function startClock() {
  const start = performance.now();
  return () => performance.now() - start;
}

/**
 * Measures the elapsed `Clock` time in milliseconds (ms) between two points.
 * @returns An effect returning the elapsed time in milliseconds (ms).
 */
export const startClockEffect: Effect.Effect<Effect.Effect<number>> =
  Effect.map(Clock.monotonicTimeNanos, (start) =>
    Effect.map(
      Clock.monotonicTimeNanos,
      (end) => Number(end - start) / 1_000_000,
    ),
  );
