import { wait } from "./wait";

type PollOptions<TData> = {
  // Whether or not to emit when the polling starts.
  emitOnBegin?: boolean;
  // The initial wait time (in ms) before polling.
  initialWaitTime?: (data: TData | void) => Promise<number>;
  // The interval (in ms).
  interval: number;
};

/**
 * @description Polls a function at a specified interval.
 */
export function poll<TData>(
  fn: ({ unpoll }: { unpoll: () => void }) => Promise<TData | void>,
  { emitOnBegin, initialWaitTime, interval }: PollOptions<TData>
) {
  let active = true;

  const unwatch = () => (active = false);

  const watch = async () => {
    let data: TData | void;
    if (emitOnBegin) data = await fn({ unpoll: unwatch });

    const initialWait = (await initialWaitTime?.(data)) ?? interval;
    await wait(initialWait);

    const poll = async () => {
      if (!active) return;
      await fn({ unpoll: unwatch });
      await wait(interval);
      poll();
    };

    poll();
  };
  watch();

  return unwatch;
}
