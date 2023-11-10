import { wait } from "./wait.js";

// Adapted from viem.
// https://github.com/wagmi-dev/viem/blob/38422ac7617022761ee7aa87310dd89adb34573c/src/utils/poll.ts

type PollOptions = {
  // Whether or not to emit when the polling starts.
  emitOnBegin?: boolean;
  // The interval (in ms).
  interval: number;
};

/**
 * @description Polls a function at a specified interval.
 */
export function poll(
  fn: ({ unpoll }: { unpoll: () => void }) => Promise<unknown> | unknown,
  { emitOnBegin, interval }: PollOptions,
) {
  let active = true;

  const unwatch = () => (active = false);

  const watch = async () => {
    if (emitOnBegin) await fn({ unpoll: unwatch });
    await wait(interval);

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
