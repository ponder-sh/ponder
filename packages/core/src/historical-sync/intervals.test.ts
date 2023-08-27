import { expect, test } from "vitest";

import { removeIntervalsFromIntervals } from "./intervals";

test("removeIntervalsFromIntervals handles overlap", () => {
  expect(removeIntervalsFromIntervals([[1, 5]], [[0, 3]])).toMatchObject([
    [4, 5],
  ]);
});

test("removeIntervalsFromIntervals handles double overlap", () => {
  expect(
    removeIntervalsFromIntervals(
      [
        [1, 5],
        [10, 15],
      ],
      [[3, 12]]
    )
  ).toMatchObject([
    [1, 2],
    [13, 15],
  ]);
});

test("removeIntervalsFromIntervals handles unaffected interval", () => {
  expect(
    removeIntervalsFromIntervals(
      [
        [1, 5],
        [9, 12],
      ],
      [[0, 3]]
    )
  ).toMatchObject([
    [4, 5],
    [9, 12],
  ]);
});
