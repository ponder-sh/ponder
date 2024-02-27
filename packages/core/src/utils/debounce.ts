/**
 * Creates a debounced function that gets called at most once every "ms" milliseconds.
 *
 * 1) Function is being called for the first time, invoke immediately
 * 2) Function has been called within the interval, but no timeout is set
 * 3) Function has been called within the interval, timeout is already set
 */
export function debounce<param extends unknown[], returnType>(
  ms: number,
  fun: (...x: param) => returnType,
) {
  let lastTimestamp = 0;
  let args: param | undefined;

  return (..._args: param) => {
    if (Date.now() > lastTimestamp + ms) {
      lastTimestamp = Date.now();

      fun(..._args);
      args = undefined;
    } else {
      if (args === undefined) {
        // No timeout is set
        setTimeout(
          () => {
            fun(...args!);
            args = undefined;
          },
          lastTimestamp + ms - Date.now(),
        );
      }

      args = _args;
      lastTimestamp = Date.now();
    }
  };
}
