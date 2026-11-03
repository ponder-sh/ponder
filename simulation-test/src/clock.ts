import { type Clock, Duration, Effect } from "effect";

type Sleeper = { at: number; seq: number; wake: () => void };

/** A `Clock` that moves only when the step loop advances it. */
export type SimClock = Clock.Clock & {
  /** The deadline of the earliest pending sleep. */
  nextWakeup: () => number | undefined;
  /** Sets the time to `at` and schedules the wake-up of each sleep due at `at` or before. */
  advanceTo: (at: number) => void;
};

export function makeSimClock(
  startMs: number,
  schedule: (run: () => void) => void,
): SimClock {
  let now = startMs;
  let seq = 0;
  // Sorted by (at, seq).
  const sleepers: Sleeper[] = [];

  const insert = (sleeper: Sleeper) => {
    let low = 0;
    let high = sleepers.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      const other = sleepers[mid]!;
      if (
        other.at < sleeper.at ||
        (other.at === sleeper.at && other.seq < sleeper.seq)
      )
        low = mid + 1;
      else high = mid;
    }
    sleepers.splice(low, 0, sleeper);
  };

  const sleep = (duration: Duration.Duration) =>
    Effect.callback<void>((resume) => {
      const ms = Duration.toMillis(duration);
      if (ms === Number.POSITIVE_INFINITY) return;
      const sleeper: Sleeper = {
        at: now + Math.max(ms, 0),
        seq: seq++,
        wake: () => resume(Effect.void),
      };
      insert(sleeper);
      return Effect.sync(() => {
        const index = sleepers.indexOf(sleeper);
        if (index !== -1) sleepers.splice(index, 1);
      });
    });

  const nanos = () => BigInt(Math.round(now * 1_000_000));

  return {
    currentTimeMillisUnsafe: () => now,
    currentTimeMillis: Effect.sync(() => now),
    currentTimeNanosUnsafe: nanos,
    currentTimeNanos: Effect.sync(nanos),
    monotonicTimeNanosUnsafe: nanos,
    monotonicTimeNanos: Effect.sync(nanos),
    sleep,
    nextWakeup: () => sleepers[0]?.at,
    advanceTo: (at) => {
      if (at < now) throw new Error(`clock cannot move back: ${now} -> ${at}`);
      now = at;
      while (sleepers.length > 0 && sleepers[0]!.at <= now) {
        schedule(sleepers.shift()!.wake);
      }
    },
  };
}
