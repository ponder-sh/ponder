import { promiseWithResolvers } from "@ponder/common";

export async function* getNonBlockingAsyncGenerator<T>(
  generator: AsyncGenerator<T>,
): AsyncGenerator<T> {
  // TODO(kyle) merged results
  const results: T[] = [];
  let done = false;

  let pwr = promiseWithResolvers<void>();

  (async () => {
    for await (const result of generator) {
      results.push(result);
      pwr.resolve();
    }
    done = true;
    pwr.resolve();
  })();

  while (done === false || results.length > 0) {
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
