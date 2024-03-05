/**
 * Creates a debounced function that waits ms milliseconds between invocations.
 * If the function is called multiple times between invocations, the latest
 * arguments passed to the function will be used.
 */
export function debounce<param extends unknown[], returnType>(
  ms: number,
  fn: (...x: param) => returnType,
) {
  let args: param;
  let timeoutSet = false;
  let timeout: NodeJS.Timeout;

  return {
    call: (..._args: param) => {
      args = _args;

      if (!timeoutSet) {
        timeoutSet = true;
        timeout = setTimeout(() => {
          timeoutSet = false;
          fn(...args);
        }, ms);
      }
    },
    cancel: () => {
      clearTimeout(timeout);
    },
  };
}
