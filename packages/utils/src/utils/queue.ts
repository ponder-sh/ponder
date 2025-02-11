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
  start: () => Promise<void>;
  pause: () => void;
  onIdle: () => Promise<void>;
  onEmpty: () => Promise<void>;
  setParameters: (
    parameters: Pick<
      CreateQueueParameters<unknown, unknown>,
      "frequency" | "concurrency"
    >,
  ) => void;
};

export type CreateQueueParameters<returnType, taskType> = {
  worker: (task: taskType) => Promise<returnType>;
  initialStart?: boolean;
  browser?: boolean;
} & (
  | {
      concurrency: number;
      frequency: number;
    }
  | { concurrency: number; frequency?: undefined }
  | { concurrency?: undefined; frequency: number }
);

const validateParameters = ({
  concurrency,
  frequency,
}: Pick<
  CreateQueueParameters<unknown, unknown>,
  "frequency" | "concurrency"
>) => {
  if (concurrency === undefined && frequency === undefined) {
    throw new Error(
      "Invalid queue configuration, must specify either 'concurrency' or 'frequency'.",
    );
  }

  if (concurrency !== undefined && concurrency <= 0) {
    throw new Error(
      `Invalid value for queue 'concurrency' option. Got ${concurrency}, expected a number greater than zero.`,
    );
  }

  if (frequency !== undefined && frequency <= 0) {
    throw new Error(
      `Invalid value for queue 'frequency' option. Got ${frequency}, expected a number greater than zero.`,
    );
  }
};

export const createQueue = <returnType, taskType = void>({
  worker,
  initialStart = false,
  browser = true,
  ..._parameters
}: CreateQueueParameters<returnType, taskType>): Queue<
  returnType,
  taskType
> => {
  validateParameters(_parameters);

  const parameters: Pick<
    CreateQueueParameters<unknown, unknown>,
    "frequency" | "concurrency"
  > = _parameters;
  let queue = new Array<InnerQueue<returnType, taskType>[number]>();
  let pending = 0;
  let timestamp = 0;
  let requests = 0;
  let isStarted = initialStart;

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
      (parameters.frequency !== undefined
        ? requests < parameters.frequency
        : true) &&
      (parameters.concurrency !== undefined
        ? pending < parameters.concurrency
        : true) &&
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

          browser ? next() : process.nextTick(next);
        });

      if (emptyPromiseWithResolvers !== undefined && queue.length === 0) {
        emptyPromiseWithResolvers.resolve();
        emptyPromiseWithResolvers.completed = true;
      }
    }

    if (
      parameters.frequency !== undefined &&
      requests >= parameters.frequency
    ) {
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
    pending: () => {
      if (browser) {
        return new Promise<number>((resolve) =>
          setTimeout(() => resolve(pending)),
        );
      } else {
        return new Promise<number>((resolve) =>
          setImmediate(() => resolve(pending)),
        );
      }
    },
    add: (task: taskType) => {
      const { promise, resolve, reject } = promiseWithResolvers<returnType>();
      queue.push({ task, resolve, reject });

      next();

      return promise.catch((error) => {
        Error.captureStackTrace(error);
        throw error;
      });
    },
    clear: () => {
      queue = new Array<InnerQueue<returnType, taskType>[number]>();
      clearTimeout(timer);
      timer = undefined;
    },
    isStarted: () => isStarted,
    start: () => {
      if (browser) {
        return new Promise<number>((resolve) =>
          setTimeout(() => resolve(pending)),
        ).then(() => {
          isStarted = true;
          next();
        });
      } else {
        return new Promise<number>((resolve) =>
          process.nextTick(() => resolve(pending)),
        ).then(() => {
          isStarted = true;
          next();
        });
      }
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
    setParameters: (_parameters) => {
      validateParameters(_parameters);

      if ("frequency" in _parameters) {
        parameters.frequency = _parameters.frequency;
      }
      if ("concurrency" in _parameters) {
        parameters.concurrency = _parameters.concurrency;
      }
    },
  } as Queue<returnType, taskType>;
};
