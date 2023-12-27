type RequestQueue = {
  /**
   * Add a task to the queue.
   * Lower block number means higher priority for historical tasks.
   */
  add: <T, TType extends "realtime" | "historical">(
    type: TType,
    func: () => Promise<T>,
    blockNumber?: TType extends "historical" ? number : never,
  ) => Promise<T>;
  /** Number of unsent requests. */
  size: () => Promise<number>;
  /** Number of pending requests. */
  pending: () => Promise<number>;
  /** Start execution of the tasks. */
  start: () => void;
  /** Pause execution of the tasks. */
  pause: () => void;
  /** Clear tasks from the queue. */
  clear: () => void;
  /** Reject all promises in the queue. */
  kill: () => void;
};

type Task = {
  func: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: () => unknown;
};

/**
 * Creates a queue built to manage rpc requests.
 *
 * Two task types, historical and realtime.
 * FIFO ordering, with "realtime" tasks always run before "historical".
 *
 * @todo Change this to accept RPC requests instead of arbitrary callbacks
 */
export const createRequestQueue = (requestsPerSecond: number): RequestQueue => {
  let historicalQueue: Task[] = new Array();
  let realtimeQueue: Task[] = new Array();
  const interval = 1000 / requestsPerSecond;

  let lastRequestTime = 0;
  let pending = 0;
  let timing = false;
  let on = true;

  let id = 0;
  const pendingRequests: Map<number, Task> = new Map();

  const processQueue = () => {
    if (!on) return;
    const realtimeLength = realtimeQueue.length;
    const historicalLength = historicalQueue.length;

    if (realtimeLength === 0 && historicalLength === 0) return;
    const now = Date.now();
    let timeSinceLastRequest = now - lastRequestTime;

    if (timeSinceLastRequest >= interval) {
      lastRequestTime = now;
      const { func, resolve, reject } =
        realtimeLength === 0
          ? historicalQueue.shift()!
          : realtimeQueue.shift()!;

      const _id = id;
      pending += 1;
      pendingRequests.set(_id, { func, resolve, reject });

      func!()
        .then((a) => {
          resolve(a);
        })
        .catch(reject)
        .finally(() => {
          pendingRequests.delete(_id);
          id += 1;
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
    add: <T, TType extends "realtime" | "historical">(
      type: TType,
      func: () => Promise<T>,
      blockNumber?: TType extends "historical" ? number : never,
    ): Promise<T> => {
      if (type === "historical" && typeof blockNumber === "number") {
        // use blocknumber as priority
      }
      const p = new Promise((resolve, reject) => {
        (type === "realtime" ? realtimeQueue : historicalQueue).push({
          func,
          resolve,
          reject,
        });
      });
      processQueue();
      return p as Promise<T>;
    },
    size: async () =>
      new Promise<number>((res) =>
        setImmediate(() => res(realtimeQueue.length + historicalQueue.length)),
      ),
    pending: async () =>
      new Promise<number>((res) => setImmediate(() => res(pending))),
    start: () => {
      on = true;
      processQueue();
    },
    pause: () => {
      on = false;
    },
    clear: () => {
      historicalQueue = new Array();
      realtimeQueue = new Array();
    },
    kill: () => {
      for (const { reject } of historicalQueue) {
        reject();
      }
      for (const { reject } of realtimeQueue) {
        reject();
      }
      for (const [, { reject }] of pendingRequests) {
        reject();
      }
    },
  };
};
