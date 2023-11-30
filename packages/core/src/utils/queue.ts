import type { DefaultAddOptions, Options, Queue as TPQueue } from "p-queue";
import PQueue, { AbortError } from "p-queue";
import { setTimeout } from "timers/promises";

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
  signal: AbortSignal;
}) => Promise<TReturn>;

type OnAdd<TTask, TContext = undefined> = (arg: {
  task: TTask;
  context: TContext | undefined;
  queue: Queue<TTask>;
}) => unknown;

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
  onAdd,
  onComplete,
  onError,
  onIdle,
}: {
  worker: Worker<TTask, TContext, TReturn>;
  context?: TContext;
  options?: QueueOptions;
  onAdd?: OnAdd<TTask, TContext>;
  onComplete?: OnComplete<TTask, TContext, TReturn>;
  onError?: OnError<TTask, TContext>;
  onIdle?: () => unknown;
}): Queue<TTask> {
  const queue = new PQueue(options) as Queue<TTask>;

  if (onIdle) {
    queue.on("idle", () => onIdle());
  }

  const controller = new AbortController();
  const queueSignal = controller.signal;

  // Override clear to also abort any pending tasks.
  const superClear = queue.clear.bind(queue);
  queue.clear = () => {
    controller.abort();
    superClear();
  };

  const taskControllers: Set<AbortController> = new Set();

  // propogate the queue-level abort down to all tasks
  queueSignal.addEventListener("abort", () => {
    taskControllers.forEach((t) => t.abort());
  });

  queue.addTask = async (task, taskOptions) => {
    const priority = taskOptions?.priority ?? 0;
    const taskController = new AbortController();
    taskControllers.add(taskController);

    let retryTimeout: number | undefined = undefined;
    if (taskOptions?.retry) {
      task._retryCount = !task._retryCount ? 0 : task._retryCount + 1;

      if (task._retryCount >= TASK_RETRY_TIMEOUT.length) {
        retryTimeout = TASK_RETRY_TIMEOUT[task._retryCount - 1];
      } else {
        retryTimeout = TASK_RETRY_TIMEOUT[task._retryCount];
      }
    }

    onAdd?.({ task, context, queue });

    try {
      await queue.add(
        async () => {
          if (retryTimeout)
            await setTimeout(retryTimeout, false, { signal: queueSignal });

          const result = await worker({
            task,
            context,
            queue,
            signal: taskController.signal!,
          });
          await onComplete?.({ result, task, context, queue });
        },
        {
          priority,
          timeout: TASK_TIMEOUT + (retryTimeout ?? 0),
          throwOnTimeout: true,
        },
      );
    } catch (error_) {
      taskController.abort();
      if (!(error_ instanceof AbortError) && !queueSignal.aborted) {
        await onError?.({ error: error_ as Error, task, context, queue });
      }
    }
    taskControllers.delete(taskController);
  };

  return queue;
}
