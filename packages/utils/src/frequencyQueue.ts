import {
  type PromiseWithResolvers,
  promiseWithResolvers,
} from "./promiseWithResolvers.js";
import type { InnerQueue, Queue } from "./queue.js";

export const createFrequencyQueue = <returnType, parameter = void>({
  frequency,
  worker,
}: {
  frequency: number;
  worker: (arg: parameter) => Promise<returnType>;
}): Queue<returnType, parameter> => {
  let queue = new Array<InnerQueue<returnType, parameter>[number]>();
  let pending = 0;
  let timestamp = 0;
  let requests = 0;
  let isStarted = false;

  let timer: NodeJS.Timeout | undefined;

  let emptyPromiseWithResolvers:
    | (PromiseWithResolvers<void> & { completed: boolean })
    | undefined = undefined;
  let idlePromiseWithResolvers:
    | (PromiseWithResolvers<void> & { completed: boolean })
    | undefined = undefined;

  const next = () => {
    if (!isStarted) return;

    const _timestamp = Date.now();

    if (Math.floor(_timestamp / 1_000) !== timestamp) {
      requests = 0;
      timestamp = Math.floor(_timestamp / 1_000);

      if (timer) clearTimeout(timer);
      timer = undefined;
    }

    if (requests >= frequency) {
      if (!timer) timer = setTimeout(next, 1_000 - (_timestamp % 1_000));
      return;
    }

    while (requests < frequency && queue.length > 0) {
      const { parameter, resolve, reject } = queue.shift()!;

      requests++;
      pending++;

      worker(parameter)
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
    queue,
    size: () => queue.length,
    pending: () =>
      new Promise<number>((resolve) =>
        process.nextTick(() => resolve(pending)),
      ),
    add: (task: parameter) => {
      const { promise, resolve, reject } = promiseWithResolvers<returnType>();
      queue.push({ parameter: task, resolve, reject });

      next();

      return promise;
    },
    clear: () => {
      queue = new Array<InnerQueue<returnType, parameter>[number]>();
      clearTimeout(timer);
      timer = undefined;
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
  } as Queue<returnType, parameter>;
};
