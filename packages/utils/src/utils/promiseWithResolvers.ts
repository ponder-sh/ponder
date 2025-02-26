export type PromiseWithResolvers<TPromise> = {
  resolve: (arg: TPromise) => void;
  reject: (error: Error) => void;
  promise: Promise<TPromise>;
};

/**
 * @description Application level polyfill.
 */
export const promiseWithResolvers = <
  TPromise,
>(): PromiseWithResolvers<TPromise> => {
  let resolve: (arg: TPromise) => void;
  let reject: (error: Error) => void;
  const promise = new Promise<TPromise>((_resolve, _reject) => {
    resolve = _resolve;
    reject = _reject;
  });
  return { resolve: resolve!, reject: reject!, promise };
};
