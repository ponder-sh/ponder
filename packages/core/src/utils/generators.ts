import { promiseWithResolvers } from "@/utils/promiseWithResolvers.js";
import { startClock } from "./timer.js";

/**
 * Merges multiple async generators into a single async generator.
 *
 * @param generators - The generators to merge.
 * @returns A single async generator that yields results from all input generators.
 */
export async function* mergeAsyncGenerators<T>(
  generators: AsyncGenerator<T>[],
): AsyncGenerator<T> {
  const CONCURRENCY_LIMIT = 2;

  if (generators.length === 0) return;

  const activeGenerators: {
    generator: AsyncGenerator<T>;
    promise: Promise<IteratorResult<T>>;
  }[] = [];
  const remainingGenerators = generators;

  for (let i = 0; i < Math.min(CONCURRENCY_LIMIT, generators.length); i++) {
    const generator = remainingGenerators.shift()!;
    const promise = generator.next();
    activeGenerators.push({ generator, promise });
  }

  while (activeGenerators.length > 0) {
    const wrappedPromises = activeGenerators.map((generator, index) =>
      generator.promise.then((result) => ({ index, result })),
    );

    const { index, result } = await Promise.race(wrappedPromises);

    if (result.done) {
      activeGenerators.splice(index, 1);
      if (remainingGenerators.length > 0) {
        const generator = remainingGenerators.shift()!;
        activeGenerators.push({ generator, promise: generator.next() });
      }
    } else {
      remainingGenerators.push(activeGenerators[index]!.generator);
      activeGenerators.splice(index, 1);

      const generator = remainingGenerators.shift()!;
      activeGenerators.push({ generator, promise: generator.next() });

      yield result.value;
    }
  }
}

/**
 * Maps the results of an async generator.
 *
 * @param generator - The generator to map.
 * @param fn - The function to map the generator.
 * @returns An async generator that yields mapped results from the input generator.
 */
export async function* mapAsyncGenerator<T, R>(
  generator: AsyncGenerator<T>,
  fn: (value: T) => R,
): AsyncGenerator<R> {
  for await (const value of generator) {
    yield fn(value);
  }
}

/**
 * Buffers the results of an async generator.
 *
 * @param generator - The generator to buffer.
 * @param size - The size of the buffer.
 * @returns An async generator that yields results from the input generator.
 */
export async function* bufferAsyncGenerator<T>(
  generator: AsyncGenerator<T>,
  size: number,
): AsyncGenerator<T> {
  const buffer: T[] = [];
  let done = false;

  let pwr1 = promiseWithResolvers<void>();
  let pwr2 = promiseWithResolvers<void>();

  (async () => {
    for await (const result of generator) {
      buffer.push(result);

      pwr1.resolve();

      if (buffer.length > size) await pwr2.promise;
      pwr2 = promiseWithResolvers<void>();
    }
    done = true;
    pwr1.resolve();
  })();

  while (done === false || buffer.length > 0) {
    if (buffer.length > 0) {
      pwr2.resolve();

      yield buffer.shift()!;
    } else {
      await pwr1.promise;
      pwr1 = promiseWithResolvers<void>();
    }
  }
}

/**
 * Drains an async generator into an array.
 *
 * @param asyncGenerator - The async generator to drain.
 * @returns An array of results from the input generator.
 */
export async function drainAsyncGenerator<T>(
  asyncGenerator: AsyncGenerator<T>,
): Promise<T[]> {
  const result: T[] = [];

  for await (const events of asyncGenerator) {
    result.push(events);
  }

  return result;
}

/**
 * Records the total time taken to yield results from an async generator.
 *
 * @param asyncGenerator - The async generator to record.
 * @param callback - A callback function that receives duration metrics.
 * @returns An async generator that yields results from the input generator.
 */
export async function* recordAsyncGenerator<T>(
  asyncGenerator: AsyncGenerator<T>,
  callback: (params: { await: number; yield: number; total: number }) => void,
): AsyncGenerator<T> {
  let endClockTotal = startClock();
  for await (const result of asyncGenerator) {
    const endClockInner = startClock();
    yield result;
    callback({
      await: endClockTotal() - endClockInner(),
      yield: endClockInner(),
      total: endClockTotal(),
    });
    endClockTotal = startClock();
  }
}

/**
 * Creates an async generator that yields values from a callback.
 */
export function createCallbackGenerator<T, P>(): {
  callback: (value: T) => Promise<P>;
  generator: AsyncGenerator<
    { value: T; onComplete: (value: P) => void },
    void,
    unknown
  >;
} {
  const buffer: { value: T; onComplete: (value: P) => void }[] = [];
  let pwr = promiseWithResolvers<void>();

  const callback = async (value: T) => {
    const { resolve, promise } = promiseWithResolvers<P>();
    buffer.push({ value, onComplete: resolve });
    pwr.resolve();
    return promise;
  };

  async function* generator() {
    while (true) {
      if (buffer.length > 0) {
        const { value, onComplete } = buffer.shift()!;
        yield { value, onComplete };
      } else {
        await pwr.promise;
        pwr = promiseWithResolvers<void>();
      }
    }
  }

  return { callback, generator: generator() };
}
