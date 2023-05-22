import Emittery from "emittery";
import PQueue, { DefaultAddOptions, Options, Queue as TPQueue } from "p-queue";

// Note that the returned queue is not actually an Emittery, it's an EventEmitter3.
// But it follows the Emittery types for "on" and "emit", so this works.
export type Queue<TTask, TReturn = void> = PQueue & {
  addTask: (task: TTask, options?: { priority?: number }) => Promise<void>;
  addTasks: (tasks: TTask[], options?: { priority?: number }) => Promise<void>;
} & Pick<
    Emittery<{
      completed: { result: TReturn; task: TTask };
      error: { error: Error; task: TTask };
    }>,
    "on" | "emit"
  >;

export type Worker<TTask, TContext = undefined, TReturn = void> = (arg: {
  task: TTask;
  context: TContext;
  queue: Queue<TTask, TReturn>;
}) => Promise<TReturn>;

export function createQueue<TTask, TContext, TReturn>({
  worker,
  context,
  options,
}: {
  worker: Worker<TTask, TContext, TReturn>;
  context: TContext;
  options: Options<
    TPQueue<() => Promise<unknown>, DefaultAddOptions>,
    DefaultAddOptions
  >;
}): Queue<TTask, TReturn> {
  const queue = new PQueue(options) as Queue<TTask, TReturn>;

  const buildTask = (task: TTask, queue: Queue<TTask, TReturn>) => async () => {
    return await worker({ task, context, queue });
  };

  queue.addTask = async (task, options) => {
    try {
      const result = await queue.add(buildTask(task, queue), options);
      queue.emit("completed", { result, task });
    } catch (error_) {
      queue.emit("error", { error: error_ as Error, task });
    }
  };

  queue.addTasks = async (tasks, options) => {
    await Promise.all(
      tasks.map(async (task) => {
        try {
          const result = await queue.add(buildTask(task, queue), options);
          queue.emit("completed", { result, task });
        } catch (error_) {
          queue.emit("error", { error: error_ as Error, task });
        }
      })
    );
  };

  return queue;
}
