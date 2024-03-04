import {
  type PromiseWithResolvers,
  promiseWithResolvers,
} from "./promiseWithResolvers.js";
import type { InnerQueue, Queue } from "./queue.js";

export const createConcurrencyQueue = <returnType, taskType = void>({
  concurrency,
  worker,
}: {
  concurrency: number;
  worker: (task: taskType) => Promise<returnType>;
}): Queue<returnType, taskType> => {
  let queue = new Array<InnerQueue<returnType, taskType>[number]>();
  let pending = 0;
  let isStarted = false;

  let emptyPromiseWithResolvers:
    | (PromiseWithResolvers<void> & { completed: boolean })
    | undefined = undefined;
  let idlePromiseWithResolvers:
    | (PromiseWithResolvers<void> & { completed: boolean })
    | undefined = undefined;

  const next = () => {
    if (!isStarted) return;

    while (pending < concurrency && queue.length > 0) {
      const { task, resolve, reject } = queue.shift()!;

      pending++;

      worker(task)
        .then(resolve)
        .catch(reject)
        .finally(() => {
          pending--;

          if (
            idlePromiseWithResolvers !== undefined &&
            queue.length === 0 &&
            pending === 0
          ) {
            idlePromiseWithResolvers.resolve();
            idlePromiseWithResolvers.completed = true;
          }

          process.nextTick(next);
        });

      if (emptyPromiseWithResolvers !== undefined && queue.length === 0) {
        emptyPromiseWithResolvers.resolve();
        emptyPromiseWithResolvers.completed = true;
      }
    }
  };

  return {
    size: () => queue.length,
    pending: () =>
      new Promise<number>((resolve) =>
        process.nextTick(() => resolve(pending)),
      ),
    add: (task: taskType) => {
      const { promise, resolve, reject } = promiseWithResolvers<returnType>();
      queue.push({ task, resolve, reject });

      next();

      return promise;
    },
    clear: () => {
      queue = new Array<InnerQueue<returnType, taskType>[number]>();
    },
    isStarted: () => isStarted,
    start: () => {
      isStarted = true;
      next();
    },
    pause: () => {
      isStarted = false;
    },
    onIdle: () => {
      if (
        idlePromiseWithResolvers === undefined ||
        idlePromiseWithResolvers.completed
      ) {
        if (queue.length === 0 && pending === 0) return Promise.resolve();

        idlePromiseWithResolvers = {
          ...promiseWithResolvers<void>(),
          completed: false,
        };
      }
      return idlePromiseWithResolvers.promise;
    },
    onEmpty: () => {
      if (
        emptyPromiseWithResolvers === undefined ||
        emptyPromiseWithResolvers.completed
      ) {
        if (queue.length === 0) return Promise.resolve();

        emptyPromiseWithResolvers = {
          ...promiseWithResolvers<void>(),
          completed: false,
        };
      }
      return emptyPromiseWithResolvers.promise;
    },
  } as Queue<returnType, taskType>;
};
