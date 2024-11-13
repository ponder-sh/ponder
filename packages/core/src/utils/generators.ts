import { promiseWithResolvers } from "@ponder/common";

export async function* getNonblockingAsyncGenerator<T>(
  generator: AsyncGenerator<T>,
): AsyncGenerator<T> {
  const results: T[] = [];

  // TODO(kyle) race condition on initial result

  let pwr = promiseWithResolvers<void>();

  (async () => {
    for await (const result of generator) {
      results.push(result);
      pwr.resolve();
    }
    pwr.resolve();
  })();

  while (results.length > 0) {
    if (results.length > 0) {
      yield results.shift()!;
    } else {
      await pwr.promise;
      pwr = promiseWithResolvers<void>();
    }
  }
}

export async function* bufferAsyncGenerator<T>(
  generator: AsyncGenerator<T>,
  size: number,
): AsyncGenerator<T> {
  const buffer: T[] = [];
  // TODO(kyle)
}
