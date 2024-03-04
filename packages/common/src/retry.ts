import { promiseWithResolvers } from "./promiseWithResolvers.js";

export const retry = <returnType>(
  callback: () => Promise<returnType>,
  {
    retries = 3,
    timeout = 100,
    exponential = true,
  }: {
    retries?: number;
    timeout?: number;
    exponential?: boolean;
  } = { retries: 3, timeout: 100, exponential: true },
): { promise: Promise<returnType>; cancel: () => void } => {
  const { promise, resolve, reject } = promiseWithResolvers<returnType>();

  let error: any;
  let hasError = false;

  let canceled = false;
  let timer: NodeJS.Timeout | undefined;

  const process = async () => {
    for (let i = 0; i < retries + 1; i++) {
      if (canceled) return;
      try {
        const out = await callback();
        resolve(out);
        return;
      } catch (_error) {
        if (!hasError) {
          hasError = true;
          error = _error;
        }

        if (canceled) return;

        await new Promise((_resolve) => {
          timer = setTimeout(
            _resolve,
            exponential ? timeout * 2 ** i : timeout,
          );
        });
      }
    }
    reject(error);
  };

  process();

  return {
    promise,
    cancel: () => {
      canceled = true;
      clearTimeout(timer);
      reject(new Error("Retry canceled"));
    },
  };
};
