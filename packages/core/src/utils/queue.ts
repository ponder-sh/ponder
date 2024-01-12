import type { Prettify } from "@/types/utils.js";
import type { DefaultAddOptions, Options, Queue as TPQueue } from "p-queue";
import PQueue from "p-queue";

type TaskOptions = { priority?: number };

export type Queue<TTask> = PQueue & {
  addTask: (task: TTask, options?: TaskOptions) => Promise<void>;
};

type QueueOptions = Prettify<
  Options<TPQueue<() => Promise<unknown>, DefaultAddOptions>, DefaultAddOptions>
>;

export type Worker<TTask, TReturn = void> = (arg: {
  task: TTask;
  queue: Queue<TTask>;
}) => Promise<TReturn>;

type OnError<TTask> = (arg: {
  error: Error;
  task: TTask;
  queue: Queue<TTask>;
}) => unknown;

/**
 * Creates a Queue object that has a number of features tailored
 * to Ponder's indexing engine, including:
 * - A shared context object accessible by all tasks
 * - An onError callback that is called _within_ the failed task scope,
 *   allowing the user to retry/add more tasks without the queue going idle.
 */
export function createQueue<TTask, TReturn = void>({
  worker,
  options,
  onError,
  onIdle,
}: {
  worker: Worker<TTask, TReturn>;
  options?: QueueOptions;
  onError?: OnError<TTask>;
  onIdle?: () => unknown;
}): Queue<TTask> {
  const queue = new PQueue(options) as Queue<TTask>;

  if (onIdle) {
    queue.on("idle", () => onIdle());
  }

  queue.addTask = async (task, taskOptions) => {
    const priority = taskOptions?.priority ?? 0;

    try {
      await queue.add(
        () => {
          return worker({
            task,
            queue,
          });
        },
        {
          priority,
        },
      );
    } catch (error_: any) {
      await onError?.({ error: error_ as Error, task, queue });
    }
  };

  return queue;
}
