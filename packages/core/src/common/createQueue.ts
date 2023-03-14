import PQueue, { DefaultAddOptions, Options, Queue as TPQueue } from "p-queue";

export type Queue<TTask> = PQueue & { addTask: (task: TTask) => void };

export function createQueue<TTask, TContext>({
  worker,
  context,
  options,
}: {
  worker: (arg: { task: TTask; context: TContext }) => Promise<void>;
  context: TContext;
  options: Options<
    TPQueue<() => Promise<unknown>, DefaultAddOptions>,
    DefaultAddOptions
  >;
}): Queue<TTask> {
  const queue = new PQueue(options) as Queue<TTask>;

  const buildTask = (task: TTask) => async () => {
    await worker({ task, context });
  };

  queue.addTask = (task: TTask) => {
    queue.add(buildTask(task)).catch((error) => {
      queue.emit("error", { error, task });
    });
  };

  return queue;
}
