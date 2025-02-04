import { promiseWithResolvers } from "@ponder/common";

/**
 * Merges multiple async generators into a single async generator.
 *
 * @param generators - The generators to merge.
 * @returns A single async generator that yields results from all input generators.
 */
export async function* mergeAsyncGenerators<T>(
  generators: AsyncGenerator<T>[],
): AsyncGenerator<T> {
  const results: T[] = [];
  let count = generators.length;
  let pwr = promiseWithResolvers<void>();

  generators.map(async (generator) => {
    for await (const result of generator) {
      results.push(result);
      pwr.resolve();
    }
    count--;
    pwr.resolve();
  });

  while (count > 0 || results.length > 0) {
    if (results.length > 0) {
      yield results.shift()!;
    } else {
      await pwr.promise;
      pwr = promiseWithResolvers<void>();
    }
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
