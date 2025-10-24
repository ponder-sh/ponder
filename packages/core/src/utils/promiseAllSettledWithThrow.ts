/**
 * Like `Promise.allSettled` but throws if any of the promises reject.
 *
 * @dev This is very useful when dealing with multiple concurrent promises
 * in a database transaction.
 */
export function promiseAllSettledWithThrow<T>(
  promises: Promise<T>[],
): Promise<T[]> {
  return Promise.allSettled(promises).then((results) => {
    if (results.some((result) => result.status === "rejected")) {
      const rejected = results.find(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      )!;
      throw rejected.reason;
    }

    return results.map((result) => (result as PromiseFulfilledResult<T>).value);
  });
}
