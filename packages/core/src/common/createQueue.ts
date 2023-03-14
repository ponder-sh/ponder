import PQueue, { DefaultAddOptions, Options, Queue as TPQueue } from "p-queue";

export type Queue<TTask> = PQueue & {
  addTask: (task: TTask, options?: { priority?: number }) => Promise<void>;
  addTasks: (tasks: TTask[], options?: { priority?: number }) => Promise<void>;
};

// TODO: Improve so the 'error' and `completed' events are properly typed.
export function createQueue<TTask, TContext, TReturn>({
  worker,
  context,
  options,
}: {
  worker: (arg: { task: TTask; context: TContext }) => Promise<TReturn>;
  context: TContext;
  options: Options<
    TPQueue<() => Promise<unknown>, DefaultAddOptions>,
    DefaultAddOptions
  >;
}): Queue<TTask> {
  const queue = new PQueue(options) as Queue<TTask>;

  const buildTask = (task: TTask) => async () => {
    return await worker({ task, context });
  };

  queue.addTask = async (task, options) => {
    try {
      const result = await queue.add(buildTask(task), options);
      queue.emit("completed", { result });
    } catch (error) {
      queue.emit("error", { error, task });
    }
  };

  queue.addTasks = async (tasks, options) => {
    await Promise.all(
      tasks.map(async (task) => {
        try {
          const result = await queue.add(buildTask(task), options);
          queue.emit("completed", { result });
        } catch (error) {
          queue.emit("error", { error, task });
        }
      })
    );
  };

  return queue;
}
