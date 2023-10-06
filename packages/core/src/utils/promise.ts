export const isSettled = <T>(
  promise: PromiseSettledResult<T>
): promise is PromiseFulfilledResult<T> => promise.status === "fulfilled";

export const isRejected = <T>(
  promise: PromiseSettledResult<T>
): promise is PromiseRejectedResult => promise.status === "rejected";
