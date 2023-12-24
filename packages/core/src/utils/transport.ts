import { type Transport, custom } from "viem";

export const rateLimitedRpc = (
  _transport: Transport,
  requestsPerSecond = 5,
): Transport => {
  const interval = 1000 / requestsPerSecond;
  let lastRequestTime = 0;

  const allowRequest = () => {
    const now = performance.now();
    if (now - lastRequestTime > interval) {
      lastRequestTime = now;
      return true;
    }
    return false;
  };

  return ({ chain }) => {
    const transport = _transport({ chain });
    const c = custom({
      async request({ method, params }) {
        return new Promise((resolve) => {
          const checkRequest = setInterval(async () => {
            if (allowRequest()) {
              clearInterval(checkRequest);

              resolve(await transport.request({ method, params }));
            }
          }, interval);
        });
      },
    });
    return c({ chain });
  };
};

type RequestQueue = {
  add: <T>(func: () => Promise<T>) => Promise<T>;
  size: () => Promise<number>;
  pending: () => Promise<number>;
};

/**
 * Creates a queue built to manage rpc requests.
 */
export const createRequestQueue = (requestsPerSecond: number): RequestQueue => {
  const queue: {
    func: () => Promise<unknown>;
    resolve: (value: unknown) => void;
    reject: () => unknown;
  }[] = new Array();
  const interval = 1000 / requestsPerSecond;

  let lastRequestTime = 0;
  let pending = 0;
  let timing = false;

  const processQueue = <T>() => {
    if (queue.length === 0) return;
    const now = performance.now();
    let timeSinceLastRequest = now - lastRequestTime;

    if (timeSinceLastRequest >= interval) {
      lastRequestTime = now;
      const { func, resolve, reject } = queue.shift()!;

      pending += 1;
      func!()
        .then((a) => {
          resolve(a as T);
        })
        .catch(reject)
        .finally(() => {
          pending -= 1;
          timeSinceLastRequest = 0;
        });
    }

    if (!timing) {
      timing = true;
      setTimeout(() => {
        timing = false;
        processQueue();
      }, interval - timeSinceLastRequest);
    }
  };

  return {
    add: <T>(func: () => Promise<T>): Promise<T> => {
      const p = new Promise((resolve, reject) => {
        queue.push({ func, resolve, reject });
      });
      processQueue<T>();
      return p as Promise<T>;
    },
    size: async () =>
      new Promise<number>((res) => setImmediate(() => res(queue.length))),
    pending: async () =>
      new Promise<number>((res) => setImmediate(() => res(pending))),
    // start
    // pause
    // clear
    // onEmpty()
    // onIdle()
  };
};
