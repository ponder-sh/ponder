import { promiseWithResolvers } from "@ponder/common";

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
