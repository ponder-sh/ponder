// Adapted from viem.
// https://github.com/wagmi-dev/viem/blob/38422ac7617022761ee7aa87310dd89adb34573c/src/utils/poll.ts

type PollOptions = {
  // Whether or not to invoke the callback when the polling starts.
  invokeOnStart?: boolean;
  // The interval (in ms).
  interval: number;
};

/**
 * @description Polls a function at a specified interval.
 */
export const poll = (
  fn: () => Promise<unknown> | unknown,
  { invokeOnStart, interval }: PollOptions,
) => {
  let cancelled = false;

  if (invokeOnStart) fn();
  const timeout = setInterval(() => {
    if (!cancelled) fn();
  }, interval);

  return () => {
    cancelled = true;
    clearInterval(timeout);
  };
};
