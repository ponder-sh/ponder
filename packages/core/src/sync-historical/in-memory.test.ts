import { expect, test } from "vitest";
import type { Filter } from "@/internal/types.js";
import type { IntervalWithFilter } from "@/runtime/index.js";
import { drainAsyncGenerator } from "@/utils/generators.js";
import type { Interval } from "@/utils/interval.js";
import { mergeGeneratorIntervals } from "./in-memory.js";

const createIntervalGenerators = (
  intervals: { interval: Interval; yields: Interval[] }[],
) => {
  const filterGenerators = new Map<
    IntervalWithFilter,
    AsyncGenerator<Interval>
  >();
  for (const { interval, yields } of intervals) {
    filterGenerators.set(
      { filter: {} as Filter, interval },
      (async function* () {
        yield* yields;
      })(),
    );
  }
  return filterGenerators;
};

test("mergeGeneratorIntervals()", async () => {
  const intervals = await drainAsyncGenerator(
    mergeGeneratorIntervals(
      createIntervalGenerators([
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

test("mergeGeneratorIntervals() with different intervals", async () => {
  const intervals = await drainAsyncGenerator(
    mergeGeneratorIntervals(
      createIntervalGenerators([
        { interval: [1, 5], yields: [[1, 5]] },
        { interval: [3, 10], yields: [[3, 10]] },
      ]),
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

test("mergeGeneratorIntervals() with no generators", async () => {
  const intervals = await drainAsyncGenerator(
    mergeGeneratorIntervals(createIntervalGenerators([])),
  );

  expect(intervals).toMatchInlineSnapshot(`[]`);
});
