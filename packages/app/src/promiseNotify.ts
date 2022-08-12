import { delayValue } from "./delay";

// For promises that take a long time (e.g. transaction confirmations),
// this helps us update loading indicators (e.g. toasts) to give users
// more feedback about what's going on.

export class PromiseNotifier<T> extends Promise<T> {
  static wrap<T>(promise: PromiseLike<T>) {
    return new PromiseNotifier<T>((resolve, reject) =>
      promise.then(resolve, reject)
    );
  }

  after(ms: number, fn: () => void) {
    const delayed = {};
    return PromiseNotifier.wrap(
      Promise.race([this, delayValue(ms, delayed)]).then((winner) => {
        if (winner === delayed) {
          fn();
        }
        return this;
      })
    );
  }
}

export const promiseNotify = <T>(promise: PromiseLike<T>) =>
  PromiseNotifier.wrap(promise);
