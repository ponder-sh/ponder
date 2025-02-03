import { ShutdownError } from "@/internal/errors.js";
import type { Shutdown } from "@/internal/shutdown.js";
import { createQueue } from "@ponder/common";

export const mutex = <T, P>(
  fn: (params: T) => Promise<P>,
  shutdown: Shutdown,
): ((params: T) => Promise<P>) => {
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

  return queue.add;
};
