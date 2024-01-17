import type { Network } from "@/config/networks.js";
import type { MetricsService } from "@/metrics/service.js";
import { type EIP1193Parameters, type PublicRpcSchema } from "viem";
import { startClock } from "./timer.js";

type RequestReturnType<
  method extends EIP1193Parameters<PublicRpcSchema>["method"],
> = Promise<Extract<PublicRpcSchema[number], { Method: method }>["ReturnType"]>;

export type RequestQueue = {
  /**
   * Add a task to the queue.
   * Lower block number means higher priority for historical tasks.
   */
  request: <TParameters extends EIP1193Parameters<PublicRpcSchema>>(
    params: TParameters,
  ) => RequestReturnType<TParameters["method"]>;
  /** Number of unsent requests. */
  size: () => Promise<number>;
  /** Number of pending requests. */
  pending: () => Promise<number>;
  /** Start execution of the tasks. */
  start: () => void;
  /** Pause execution of the tasks. */
  pause: () => void;
  /** Returns a promise that resolves when the queue is empty and all tasks have resolved. */
  onIdle: () => Promise<void>;
  /** Clear tasks from the queue. */
  clear: () => void;
  /** Internal tasks in the queue */
  queue: Task[];
};

/**
 * Internal representation of a task in the request queue.
 *
 * @param blockNumber The blockNumber (priority) of the task.
 * "latest" represents the highest priority. "null" represents lowest priority
 */
type Task = {
  params: EIP1193Parameters<PublicRpcSchema>;
  resolve: (value: unknown) => void;
  reject: () => unknown;
  stopClockLag: () => number;
};

/**
 * Creates a queue built to manage rpc requests.
 */
export const createRequestQueue = ({
  metrics,
  network,
}: { network: Network; metrics: MetricsService }): RequestQueue => {
  let queue: Task[] = new Array();
  const interval =
    1000 / network.maxRequestsPerSecond > 50
      ? 1000 / network.maxRequestsPerSecond
      : 50;
  const requestBatchSize =
    1000 / network.maxRequestsPerSecond > 50
      ? 1
      : Math.floor(network.maxRequestsPerSecond / 20);

  let lastRequestTime = 0;
  let pending = 0;
  let timeout: NodeJS.Timeout | undefined = undefined;
  let timing = false;
  let on = true;

  let idleResolve: () => void;
  let idlePromise: Promise<void> = new Promise<void>(
    (resolve) => (idleResolve = resolve),
  );

  const processQueue = () => {
    if (!on) return;

    if (queue.length === 0) return;
    const now = Date.now();
    let timeSinceLastRequest = now - lastRequestTime;

    if (timeSinceLastRequest >= interval) {
      lastRequestTime = now;

      for (let i = 0; i < requestBatchSize; i++) {
        const { params, resolve, reject, stopClockLag } = queue.shift()!;

        pending += 1;

        metrics.ponder_rpc_request_lag.observe(
          { method: params.method, network: network.name },
          stopClockLag(),
        );

        const stopClock = startClock();

        network.transport
          .request(params)
          .then((a) => {
            resolve(a);
          })
          .catch(reject)
          .finally(async () => {
            pending -= 1;
            metrics.ponder_rpc_request_duration.observe(
              { method: params.method, network: network.name },
              stopClock(),
            );

            await Promise.all([
              new Promise<number>((res) =>
                setImmediate(() => res(queue.length)),
              ),
              new Promise<number>((res) => setImmediate(() => res(pending))),
            ]).then(([size, pending]) => {
              if (size === 0 && pending === 0) {
                idleResolve();
                idlePromise = new Promise<void>(
                  (resolve) => (idleResolve = resolve),
                );
              }
            });
          });

        if (queue.length === 0) break;
      }

      timeSinceLastRequest = 0;
    }

    if (!timing) {
      timing = true;
      timeout = setTimeout(() => {
        timing = false;
        processQueue();
      }, interval - timeSinceLastRequest);
    }
  };

  return {
    request: <TParameters extends EIP1193Parameters<PublicRpcSchema>>(
      params: TParameters,
    ): RequestReturnType<TParameters["method"]> => {
      const stopClockLag = startClock();

      // Add element to the very end
      const p = new Promise((resolve, reject) => {
        queue.push({
          params,
          resolve,
          reject,
          stopClockLag,
        });
      });

      processQueue();
      return p as RequestReturnType<TParameters["method"]>;
    },
    size: () =>
      new Promise<number>((res) => setImmediate(() => res(queue.length))),
    pending: () =>
      new Promise<number>((res) => setImmediate(() => res(pending))),
    start: () => {
      on = true;
      processQueue();
    },
    pause: () => {
      on = false;
    },
    onIdle: async () => {
      if (queue.length === 0 && pending === 0) return;
      await idlePromise;
    },
    clear: () => {
      clearTimeout(timeout);
      queue = new Array();
      lastRequestTime = 0;
    },
    queue,
  };
};
