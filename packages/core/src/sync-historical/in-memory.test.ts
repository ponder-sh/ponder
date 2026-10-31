import { expect, test } from "bun:test";
import { Effect, Stream } from "effect";
import type { Filter } from "@/internal/types.js";
import type { IntervalWithFilter } from "@/runtime/index.js";
import type { Interval } from "@/utils/interval.js";
import { mergeIntervalStreams } from "./in-memory.js";

const createIntervalStreams = (
  intervals: { interval: Interval; yields: Interval[] }[],
) => {
  const filterStreams = new Map<IntervalWithFilter, Stream.Stream<Interval>>();
  for (const { interval, yields } of intervals) {
    filterStreams.set(
      { filter: {} as Filter, interval },
      Stream.fromIterable(yields),
    );
  }
  return filterStreams;
};

test("mergeIntervalStreams()", () => {
  const intervals = Effect.runSync(
    Stream.runCollect(
      mergeIntervalStreams(
        createIntervalStreams([
          {
            interval: [1, 10],
            yields: [
              [1, 4],
              [5, 10],
            ],
          },
          {
            interval: [1, 10],
            yields: [
              [1, 2],
              [3, 6],
              [7, 10],
            ],
          },
        ]),
      ),
    ),
  );

  expect(intervals).toMatchInlineSnapshot(`
    [
      [
        1,
        2,
      ],
      [
        3,
        4,
      ],
      [
        5,
        6,
      ],
      [
        7,
        10,
      ],
    ]
  `);
});

test("mergeIntervalStreams() with different intervals", () => {
  const intervals = Effect.runSync(
    Stream.runCollect(
      mergeIntervalStreams(
        createIntervalStreams([
          { interval: [1, 5], yields: [[1, 5]] },
          { interval: [3, 10], yields: [[3, 10]] },
        ]),
      ),
    ),
  );

  expect(intervals).toMatchInlineSnapshot(`
    [
      [
        1,
        5,
      ],
      [
        6,
        10,
      ],
    ]
  `);
});

test("mergeIntervalStreams() with no streams", () => {
  const intervals = Effect.runSync(
    Stream.runCollect(mergeIntervalStreams(createIntervalStreams([]))),
  );

  expect(intervals).toMatchInlineSnapshot(`[]`);
});
