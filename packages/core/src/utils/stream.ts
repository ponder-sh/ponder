import {
  type Cause,
  Clock,
  Deferred,
  Duration,
  Effect,
  Exit,
  Fiber,
  Option,
  Pull,
  Queue,
  Stream,
} from "effect";

/**
 * Buffer up to `capacity` elements of `stream`, so that it runs ahead of the
 * consumer.
 *
 * Note: The consumer takes one element at a time, so that the buffer holds every
 * element that `stream` produced ahead of the consumer.
 *
 * @param onSize - Called with the number of buffered elements after each
 * element is buffered.
 */
export const bufferWithSize = <A, E, R>(
  stream: Stream.Stream<A, E, R>,
  {
    capacity,
    onSize,
  }: {
    capacity: number | "unbounded";
    onSize: (size: number) => Effect.Effect<void>;
  },
): Stream.Stream<A, E, R> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const queue = yield* capacity === "unbounded"
        ? Queue.unbounded<A, E | Cause.Done>()
        : Queue.bounded<A, E | Cause.Done>(capacity);

      yield* stream.pipe(
        Stream.runForEach((value) =>
          Queue.offer(queue, value).pipe(
            Effect.andThen(Queue.size(queue)),
            Effect.flatMap(onSize),
          ),
        ),
        Queue.into(queue),
        Effect.forkScoped,
      );

      return Stream.fromEffectRepeat(Queue.take(queue));
    }),
  );

/**
 * Run `stream` ahead of the consumer, and emit its latest element when the
 * consumer pulls, at most once per `duration`.
 *
 * When the consumer is slower than `stream`, each pull emits right away and
 * skips the elements in between. When `stream` is slower, a pull waits up to
 * `duration` after the previous one for more elements, unless `stream` ends.
 */
export const latestWithin = <A, E, R>(
  stream: Stream.Stream<A, E, R>,
  duration: Duration.Input,
): Stream.Stream<A, E, R> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const queue = yield* Queue.unbounded<A, E | Cause.Done>();
      const isDone = yield* Deferred.make<void>();

      yield* stream.pipe(
        Stream.runForEach((value) => Queue.offer(queue, value)),
        Queue.into(queue),
        Effect.ensuring(Deferred.succeed(isDone, undefined)),
        Effect.forkScoped,
      );

      const millis = Duration.toMillis(duration);
      /** Earliest time of the next emit. */
      let next = Number.NEGATIVE_INFINITY;

      return Stream.fromEffectRepeat(
        Effect.gen(function* () {
          const values = yield* Queue.takeAll(queue);

          const remaining = next - (yield* Clock.currentTimeMillis);
          if (remaining > 0) {
            yield* Effect.raceFirst(
              Effect.sleep(remaining),
              Deferred.await(isDone),
            );
          }

          const rest = yield* Queue.clear(queue);
          next = (yield* Clock.currentTimeMillis) + millis;

          return rest.length > 0
            ? rest[rest.length - 1]!
            : values[values.length - 1]!;
        }),
      );
    }),
  );

/**
 * Merge `streams` by holding the next element of each stream, the head.
 *
 * `choose` selects the stream to pull next, and the elements to emit. It
 * receives the heads, with `undefined` for a stream that ended, and may
 * update them. The merged stream ends when every stream ended.
 *
 * Note: The selected stream is pulled while the consumer processes the
 * emitted elements.
 */
export const mergePulls = <A, B, E, R>(
  streams: ReadonlyArray<Stream.Stream<A, E, R>>,
  choose: (heads: (A | undefined)[]) => {
    index: number;
    values: ReadonlyArray<B>;
  },
): Stream.Stream<B, E, R> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const scope = yield* Effect.scope;
      const pulls = yield* Effect.forEach(streams, (stream) =>
        Stream.toPull(Stream.rechunk(stream, 1)),
      );

      /** Pull the next element of stream `index`, or `undefined` once it ended. */
      const next = (index: number) =>
        pulls[index]!.pipe(
          Effect.map(([value]): A | undefined => value),
          Pull.catchDone(() => Effect.succeed(undefined)),
        );

      const heads = yield* Effect.forEach(pulls, (_, index) => next(index), {
        concurrency: "unbounded",
      });

      /** Pull of the stream that was selected last. */
      let headFiber: Fiber.Fiber<void, E> | undefined;

      return Stream.paginate<void, B, E>(undefined, () =>
        Effect.gen(function* () {
          if (headFiber !== undefined) {
            yield* Fiber.join(headFiber);
            headFiber = undefined;
          }

          if (heads.every((head) => head === undefined)) {
            return [[], Option.none()] as const;
          }

          const { index, values } = choose(heads);

          headFiber = yield* Effect.forkIn(
            Effect.map(next(index), (head) => {
              heads[index] = head;
            }),
            scope,
            { startImmediately: true },
          );

          return [values, Option.some(undefined)] as const;
        }),
      );
    }),
  );

/**
 * Merge `streams` in the order their elements are ready, like
 * `Stream.mergeAll(streams, { concurrency: "unbounded", bufferSize })`. Each
 * stream runs in its own fiber, and at most `bufferSize` chunks wait for the
 * consumer. The merged stream fails with the first failure of a stream, and
 * ends when every stream ended.
 *
 * Note: `Stream.mergeAll` (effect 4.0.5) never ends when a stream ends before
 * the merge registers its fiber, which happens when the merge's fiber yields
 * right after the fork.
 */
export const mergeUnordered = <A, E, R>(
  streams: ReadonlyArray<Stream.Stream<A, E, R>>,
  { bufferSize }: { bufferSize: number },
): Stream.Stream<A, E, R> =>
  Stream.unwrap(
    Effect.gen(function* () {
      if (streams.length === 0) return Stream.empty;

      const scope = yield* Effect.scope;
      const queue = yield* Queue.bounded<readonly [A, ...A[]], E | Cause.Done>(
        bufferSize,
      );
      let remaining = streams.length;

      for (const stream of streams) {
        yield* Stream.runForEachArray(stream, (chunk) =>
          Queue.offer(queue, chunk),
        ).pipe(
          Effect.onExit((exit) => {
            if (Exit.isFailure(exit)) return Queue.failCause(queue, exit.cause);
            remaining--;
            return remaining === 0 ? Queue.end(queue) : Effect.void;
          }),
          Effect.forkIn(scope),
        );
      }

      return Stream.flattenArray(Stream.fromQueue(queue));
    }),
  );
