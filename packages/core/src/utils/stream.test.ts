import { expect, test } from "bun:test";
import { Effect, References, Stream } from "effect";
import { mergeUnordered } from "./stream.js";

test("mergeUnordered() ends when the streams end before they are registered", async () => {
  // Note: With these budgets, the fiber of `Stream.mergeAll` yields right
  // after a fork, and `Stream.mergeAll` never ends.
  for (const maxOpsBeforeYield of [16, 24, 32, 2048]) {
    for (let n = 0; n <= 5; n++) {
      const result = await Effect.runPromise(
        mergeUnordered(
          Array.from({ length: n }, () => Stream.empty),
          { bufferSize: 1 },
        ).pipe(
          Stream.runCollect,
          Effect.timeoutOption(1_000),
          Effect.provideService(
            References.MaxOpsBeforeYield,
            maxOpsBeforeYield,
          ),
        ),
      );
      expect(result._tag).toBe("Some");
    }
  }
});

test("mergeUnordered() emits the elements of every stream", async () => {
  const result = await Effect.runPromise(
    mergeUnordered(
      [Stream.make(1, 2), Stream.empty, Stream.make(3), Stream.make(4, 5, 6)],
      { bufferSize: 1 },
    ).pipe(Stream.runCollect),
  );
  expect([...result].sort()).toStrictEqual([1, 2, 3, 4, 5, 6]);
});

test("mergeUnordered() fails with the failure of a stream", async () => {
  const result = await Effect.runPromise(
    mergeUnordered([Stream.make(1), Stream.fail("error"), Stream.never], {
      bufferSize: 1,
    }).pipe(Stream.runCollect, Effect.flip),
  );
  expect(result).toBe("error");
});
