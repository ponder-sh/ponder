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
  let timeout: NodeJS.Timeout | undefined = undefined;

  const pendingRequests: Map<Task, Promise<unknown>> = new Map();

  let isTimerOn = false;
  let isStarted = true;

  const processQueue = () => {
    if (!isStarted) return;

    if (queue.length === 0) return;
    const now = Date.now();
    let timeSinceLastRequest = now - lastRequestTime;

    if (timeSinceLastRequest >= interval) {
      lastRequestTime = now;

      for (let i = 0; i < requestBatchSize; i++) {
        const task = queue.shift()!;

        metrics.ponder_rpc_request_lag.observe(
          { method: task.params.method, network: network.name },
          task.stopClockLag(),
        );

        const stopClock = startClock();

        const p = network.transport
          .request(task.params)
          .then(task.resolve)
          .catch(task.reject)
          .finally(() => {
            pendingRequests.delete(task);

            metrics.ponder_rpc_request_duration.observe(
              { method: task.params.method, network: network.name },
              stopClock(),
            );
          });

        pendingRequests.set(task, p);

        if (queue.length === 0) break;
      }

      timeSinceLastRequest = 0;
    }

    if (!isTimerOn) {
      isTimerOn = true;
      timeout = setTimeout(() => {
        isTimerOn = false;
        processQueue();
      }, interval - timeSinceLastRequest);
    }
  };

  return {
    request: <TParameters extends EIP1193Parameters<PublicRpcSchema>>(
      params: TParameters,
    ): RequestReturnType<TParameters["method"]> => {
      const stopClockLag = startClock();

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
      new Promise<number>((res) =>
        setImmediate(() => res(Object.keys(pendingRequests).length)),
      ),
    start: () => {
      isStarted = true;
      processQueue();
    },
    pause: () => {
      isStarted = false;
    },
    onIdle: () => Promise.all(Object.values(pendingRequests)).then(() => {}),
    clear: () => {
      clearTimeout(timeout);
      queue = new Array();
      lastRequestTime = 0;
    },
    queue,
  };
};
