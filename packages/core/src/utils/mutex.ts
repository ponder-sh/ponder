import { ShutdownError } from "@/internal/errors.js";
import type { Shutdown } from "@/internal/shutdown.js";
import { type Queue, createQueue } from "@ponder/common";

export type Mutex<T, P> = ((params: T) => Promise<P>) & Queue<P, T>;

export const mutex = <T, P>(
  fn: (params: T) => Promise<P>,
  shutdown: Shutdown,
): Mutex<T, P> => {
  const queue = createQueue({
    initialStart: true,
    browser: false,
    concurrency: 1,
    worker(params: T) {
      return fn(params);
    },
  });

  shutdown.add(() => {
    queue.pause();
    queue.clear(new ShutdownError());
    return queue.onIdle;
  });

  return Object.assign(queue.add, queue);
};
