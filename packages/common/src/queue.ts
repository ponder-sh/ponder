import {
  type PromiseWithResolvers,
  promiseWithResolvers,
} from "./promiseWithResolvers.js";

export type InnerQueue<returnType, taskType> = {
  task: taskType;
  resolve: (arg: returnType) => void;
  reject: (error: Error) => void;
}[];

export type Queue<returnType, taskType> = {
  size: () => number;
  pending: () => Promise<number>;
  add: (task: taskType) => Promise<returnType>;
  clear: () => void;
  isStarted: () => boolean;
  start: () => void;
  pause: () => void;
  onIdle: () => Promise<void>;
  onEmpty: () => Promise<void>;
};

export const createQueue = <returnType, taskType = void>({
  concurrency,
  frequency,
  worker,
}: {
  worker: (task: taskType) => Promise<returnType>;
} & (
  | {
      concurrency: number;
      frequency: number;
    }
  | { concurrency: number; frequency?: never }
  | { concurrency?: never; frequency: number }
)): Queue<returnType, taskType> => {
  // Input validation
  if (concurrency === undefined && frequency === undefined) {
    throw Error(
      "Invalid queue configuration, must specify either 'concurrency' or 'frequency'.",
    );
  }

  if (concurrency !== undefined && concurrency <= 0) {
    throw Error(
      `Invalid value for queue 'concurrency' option. Got ${concurrency}, expected a number greater than zero.`,
    );
  }

  if (frequency !== undefined && frequency <= 0) {
    throw Error(
      `Invalid value for queue 'frequency' option. Got ${frequency}, expected a number greater than zero.`,
    );
  }

  let queue = new Array<InnerQueue<returnType, taskType>[number]>();
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
    }

    if (timer) return;

    while (
      (frequency !== undefined ? requests < frequency : true) &&
      (concurrency !== undefined ? pending < concurrency : true) &&
      queue.length > 0
    ) {
      const { task, resolve, reject } = queue.shift()!;

      requests++;
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

    if (frequency !== undefined && requests >= frequency) {
      timer = setTimeout(
        () => {
          timer = undefined;
          next();
        },
        1_000 - (_timestamp % 1_000),
      );
      return;
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
  } as Queue<returnType, taskType>;
};
