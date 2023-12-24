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

/**
 * Creates a queue built to manage pending and in-flight requests.
 *
 * @todo Add returns a promise that resolves with the value of the task.
 */
export const createTransportQueue = (requestsPerSecond: number) => {
  const queue: (() => Promise<any> | any)[] = new Array();
  const interval = 1000 / requestsPerSecond;
  let lastRequestTime = 0;
  let pending = 0;
  let timing = false;

  const processQueue = () => {
    if (queue.length === 0) return;
    const now = performance.now();
    let timeSinceLastRequest = now - lastRequestTime;

    if (timeSinceLastRequest >= interval) {
      lastRequestTime = now;
      const func = queue.shift();

      new Promise<void>((res) => {
        pending += 1;
        func!().then(() => {
          pending -= 1;
          timeSinceLastRequest = 0;
          res();
        });
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
    add: <T>(func: () => Promise<T> | T) => {
      queue.push(func);
      processQueue();
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
