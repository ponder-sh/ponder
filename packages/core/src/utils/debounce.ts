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
  let args: param;
  let timeoutSet = false;

  return (..._args: param) => {
    if (timeoutSet) {
      args = _args;
    } else if (Date.now() >= lastTimestamp + ms) {
      lastTimestamp = Date.now();
      fun(..._args);
    } else {
      args = _args;
      timeoutSet = true;

      setTimeout(
        () => {
          lastTimestamp = Date.now();
          fun(...args);
          timeoutSet = false;
        },
        lastTimestamp + ms - Date.now(),
      );
    }
  };
}
