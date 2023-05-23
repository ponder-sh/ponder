import Emittery from "emittery";
import PQueue, { DefaultAddOptions, Options, Queue as TPQueue } from "p-queue";
import retry, { type CreateTimeoutOptions } from "retry";
import { setTimeout } from "timers/promises";

import { Prettify } from "@/types/utils";

type TaskOptions = { front?: boolean; retry?: boolean };

export type Queue<TTask> = PQueue & {
  addTask: (
    task: TTask & { _retryCount?: number },
    options?: TaskOptions
  ) => Promise<void>;
  addTasks: (
    tasks: (TTask & { _retryCount?: number })[],
    options?: TaskOptions
  ) => Promise<void>;
  // Note that PQueue is actually an EventEmitter3 (not an Emittery).
  // But it follows the Emittery types for "on" and "emit", so this works.
} & Pick<Emittery<{}>, "on" | "emit">;

type QueueOptions = Prettify<
  Options<
    TPQueue<() => Promise<unknown>, DefaultAddOptions>,
    DefaultAddOptions
  > & { retryTimeoutOptions?: CreateTimeoutOptions }
>;

export type Worker<TTask, TContext = undefined, TReturn = void> = (arg: {
  task: TTask;
  context: TContext | undefined;
  queue: Queue<TTask>;
}) => Promise<TReturn>;

type OnError<TTask, TContext = undefined> = (arg: {
  error: Error;
  task: TTask;
  context: TContext | undefined;
  queue: Queue<TTask>;
}) => unknown;

type OnComplete<TTask, TContext = undefined, TReturn = void> = (arg: {
  result: TReturn;
  task: TTask;
  context: TContext | undefined;
  queue: Queue<TTask>;
}) => unknown;

/**
 * Creates a Queue object that has a number of features tailored
 * to Ponder's indexing engine, including:
 * - A shared context object accessible by all tasks
 * - An onError callback that is called _within_ the failed task scope,
 *   allowing the user to retry/add more tasks without the queue going idle.
 * - An onComplete callback that is called _within_ the completed task scope.
 * - A configurable retry scheme using `node-retry`.
 */
export function createQueue<TTask, TContext = undefined, TReturn = void>({
  worker,
  context,
  options,
  onError,
  onComplete,
}: {
  worker: Worker<TTask, TContext, TReturn>;
  context?: TContext;
  options?: QueueOptions;
  onError?: OnError<TTask, TContext>;
  onComplete?: OnComplete<TTask, TContext, TReturn>;
}): Queue<TTask> {
  const queue = new PQueue(options) as Queue<TTask>;

  const controller = new AbortController();
  const signal = controller.signal;

  queue.clear = () => {
    controller.abort();
    queue.clear();
  };

  const retryTimeouts: number[] = retry.timeouts(
    options?.retryTimeoutOptions ?? {
      retries: 3,
      factor: 2,
      minTimeout: 100, // 100 ms
    }
  );

  queue.addTask = async (task, taskOptions) => {
    const priority = taskOptions?.front ? queue.size : 0;

    let retryTimeout: number | undefined = undefined;
    if (taskOptions?.retry) {
      task._retryCount ||= 0;
      task._retryCount += 1;
      if (task._retryCount > retryTimeouts.length) {
        console.log("too many retries!!!");
        return;
      } else {
        retryTimeout = retryTimeouts[task._retryCount];
      }
    }

    await queue.add(
      async () => {
        let result: TReturn;
        if (retryTimeout) await setTimeout(retryTimeout, false, { signal });
        try {
          result = await worker({ task, context, queue });
        } catch (error_) {
          await onError?.({ error: error_ as Error, task, context, queue });
          return;
        }
        await onComplete?.({ result, task, context, queue });
      },
      { priority }
    );
  };

  queue.addTasks = async (tasks, taskOptions) => {
    await Promise.all(
      tasks.map(async (task) => {
        const priority = taskOptions?.front ? queue.size : 0;

        let retryTimeout: number | undefined = undefined;
        if (taskOptions?.retry) {
          task._retryCount ||= 0;
          task._retryCount += 1;
          if (task._retryCount > retryTimeouts.length) {
            console.log("too many retries!!!");
            return;
          } else {
            retryTimeout = retryTimeouts[task._retryCount];
          }
        }

        await queue.add(
          async () => {
            let result: TReturn;
            if (retryTimeout) await setTimeout(retryTimeout, false, { signal });
            try {
              result = await worker({ task, context, queue });
            } catch (error_) {
              await onError?.({ error: error_ as Error, task, context, queue });
              return;
            }
            await onComplete?.({ result, task, context, queue });
          },
          { priority }
        );
      })
    );
  };

  return queue;
}
