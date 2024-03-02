/**
 * Creates a debounced function that waits "ms" milliseconds before being called.
 */
export function debounce<param extends unknown[], returnType>(
  ms: number,
  fun: (...x: param) => returnType,
) {
  let args: param;
  let timeoutSet = false;
  let timeout: NodeJS.Timeout;

  return {
    callback: (..._args: param) => {
      args = _args;

      if (!timeoutSet) {
        timeoutSet = true;
        timeout = setTimeout(() => {
          fun(...args);
          timeoutSet = false;
        }, ms);
      }
    },
    cancel: () => {
      clearTimeout(timeout);
    },
  };
}
