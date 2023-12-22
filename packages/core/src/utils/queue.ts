import type { DefaultAddOptions, Options, Queue as TPQueue } from "p-queue";
import PQueue from "p-queue";

import type { Prettify } from "@/types/utils.js";

type TaskOptions = { priority?: number; retry?: boolean };

/* How long to wait before aborting a task. */
export const TASK_TIMEOUT = 8000;
/* How long to wait before retrying a task. */
export const TASK_RETRY_TIMEOUT = [150, 300, 600, 1_200];

export type Queue<TTask> = PQueue & {
  addTask: (
    task: TTask & { _retryCount?: number },
    options?: TaskOptions,
  ) => Promise<void>;
};

type QueueOptions = Prettify<
  Options<TPQueue<() => Promise<unknown>, DefaultAddOptions>, DefaultAddOptions>
>;

export type Worker<TTask, TContext = undefined, TReturn = void> = (arg: {
  task: TTask;
  context: TContext | undefined;
  queue: Queue<TTask>;
}) => Promise<TReturn>;

/**
 * Creates a Queue object that has a number of features tailored
 * to Ponder's indexing engine, including:
 * - A shared context object accessible by all tasks
 *   allowing the user to retry/add more tasks without the queue going idle.
 */
export function createQueue<TTask, TContext = undefined, TReturn = void>({
  worker,
  context,
  options,
  onIdle,
}: {
  worker: Worker<TTask, TContext, TReturn>;
  context?: TContext;
  options?: QueueOptions;
  onIdle?: () => unknown;
}): Queue<TTask> {
  const queue = new PQueue(options) as Queue<TTask>;

  if (onIdle) {
    queue.on("idle", () => onIdle());
  }

  // Override clear to also abort any pending tasks.
  const superClear = queue.clear.bind(queue);
  queue.clear = () => {
    superClear();
  };

  queue.addTask = async (task, taskOptions) => {
    const priority = taskOptions?.priority ?? 0;

    await queue.add(
      async () =>
        worker({
          task,
          context,
          queue,
        }),
      {
        priority,
      },
    );
  };

  return queue;
}
