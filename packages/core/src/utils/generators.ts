import { promiseWithResolvers } from "@/utils/promiseWithResolvers.js";

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
      yield result.value;
      promises[index] = generators[index]!.next();
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
