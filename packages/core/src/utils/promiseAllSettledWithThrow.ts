/**
 * Like `Promise.allSettled` but throws if any of the promises reject.
 *
 * @dev This is very useful when dealing with multiple concurrent promises
 * in a database transaction.
 */
export async function promiseAllSettledWithThrow<T>(
  promises: Promise<T>[],
): Promise<T[]> {
  let firstError: Error | undefined;

  const result = await Promise.all(
    promises.map((promise) =>
      promise.catch((error) => {
        if (firstError === undefined) {
          firstError = error;
        }
      }),
    ),
  );

  if (firstError === undefined) {
    return result as T[];
  }

  throw firstError;
}
