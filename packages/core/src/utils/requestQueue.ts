import type { Client, EIP1193Parameters, PublicRpcSchema } from "viem";

type RequestReturnType<
  method extends EIP1193Parameters<PublicRpcSchema>["method"],
> = Promise<Extract<PublicRpcSchema[number], { Method: method }>["ReturnType"]>;

export type RequestQueue = {
  /**
   * Add a task to the queue.
   * Lower block number means higher priority for historical tasks.
   */
  request: <
    TParameters extends EIP1193Parameters<PublicRpcSchema>,
    TType extends "realtime" | "historical",
  >(
    type: TType,
    params: TParameters,
    blockNumber?: TType extends "historical" ? number : never,
  ) => RequestReturnType<TParameters["method"]>;
  /** Number of unsent requests. */
  size: () => Promise<number>;
  /** Number of unsent realtime requests. */
  realtimeSize: () => Promise<number>;
  /** Number of unsent historical requests. */
  historicalSize: () => Promise<number>;
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
  params: EIP1193Parameters<PublicRpcSchema>;
  resolve: (value: unknown) => void;
  reject: () => unknown;
};

/**
 * Creates a queue built to manage rpc requests.
 *
 * Two task types, historical and realtime.
 * FIFO ordering, with "realtime" tasks always run before "historical".
 */
export const createRequestQueue = (
  transport: Client["transport"],
  requestsPerSecond: number,
): RequestQueue => {
  let historicalQueue: Task[] = new Array();
  let realtimeQueue: Task[] = new Array();
  const interval =
    1000 / requestsPerSecond > 50 ? 1000 / requestsPerSecond : 50;
  const requestBatchSize =
    1000 / requestsPerSecond > 50 ? 1 : Math.floor(requestsPerSecond / 20);

  let lastRequestTime = 0;
  let pending = 0;
  let timing = false;
  let on = true;

  let id = 0;
  const pendingRequests: Map<number, Task> = new Map();

  const processQueue = () => {
    if (!on) return;

    if (realtimeQueue.length === 0 && historicalQueue.length === 0) return;
    const now = Date.now();
    let timeSinceLastRequest = now - lastRequestTime;

    if (timeSinceLastRequest >= interval) {
      lastRequestTime = now;

      for (let i = 0; i < requestBatchSize; i++) {
        const { params, resolve, reject } =
          realtimeQueue.length === 0
            ? historicalQueue.shift()!
            : realtimeQueue.shift()!;

        const _id = id;
        pending += 1;
        pendingRequests.set(_id, { params, resolve, reject });

        transport
          .request(params)
          .then((a) => {
            resolve(a);
          })
          .catch(reject)
          .finally(() => {
            pendingRequests.delete(_id);
            id += 1;
            pending -= 1;
          });

        if (realtimeQueue.length === 0 && historicalQueue.length === 0) break;
      }

      timeSinceLastRequest = 0;
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
    request: <
      TParameters extends EIP1193Parameters<PublicRpcSchema>,
      TType extends "realtime" | "historical",
    >(
      type: TType,
      params: TParameters,
      blockNumber?: TType extends "historical" ? number : never,
    ): RequestReturnType<TParameters["method"]> => {
      if (type === "historical" && typeof blockNumber === "number") {
        // use blocknumber as priority
      }
      const p = new Promise((resolve, reject) => {
        (type === "realtime" ? realtimeQueue : historicalQueue).push({
          params,
          resolve,
          reject,
        });
      });
      processQueue();
      return p as RequestReturnType<TParameters["method"]>;
    },
    size: async () =>
      new Promise<number>((res) =>
        setImmediate(() => res(realtimeQueue.length + historicalQueue.length)),
      ),
    realtimeSize: async () =>
      new Promise<number>((res) =>
        setImmediate(() => res(realtimeQueue.length)),
      ),
    historicalSize: async () =>
      new Promise<number>((res) =>
        setImmediate(() => res(historicalQueue.length)),
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
