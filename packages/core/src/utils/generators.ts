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
  const promises = generators.map((gen) => gen.next());

  while (promises.length > 0) {
    const wrappedPromises = promises.map((promise, index) =>
      promise.then((result) => ({ index, result })),
    );

    const { result, index } = await Promise.race(wrappedPromises);

    if (result.done) {
      generators.splice(index, 1);
      promises.splice(index, 1);
    } else {
      promises[index] = generators[index]!.next();
      yield result.value;
    }
  }
}

/**
 * Maps the results of an async generator.
 *
 * @param generators - The generator to map.
 * @param fn - The function to map the generator.
 * @returns An async generator that yields mapped results from the input generator.
 */
export async function* mapAsyncGenerator<T, R>(
  generators: AsyncGenerator<T>,
  fn: (value: T) => R,
): AsyncGenerator<R> {
  for await (const value of generators) {
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
