import { type Queue, createQueue } from "@/utils/queue.js";
import {
  type PromiseWithResolvers,
  promiseWithResolvers,
} from "./promiseWithResolvers.js";

export type Mutex<T, P> = ((params: T) => Promise<P>) & Queue<P, T>;

export const mutex = <T, P>(fn: (params: T) => Promise<P>): Mutex<T, P> => {
  const queue = createQueue({
    initialStart: true,
    browser: false,
    concurrency: 1,
    worker(params: T) {
      return fn(params);
    },
  });

  return Object.assign(queue.add, queue);
};

export const createMutex = () => {
  const queue = createQueue({
    initialStart: true,
    browser: false,
    concurrency: 1,
    worker({ fn, params }: { fn: (params: any) => Promise<any>; params: any }) {
      return fn(params);
    },
  });

  const mutex =
    <T, P>(fn: (params: T) => Promise<P>) =>
    (params: T) =>
      queue.add({ fn, params }) as Promise<P>;

  return Object.assign(mutex, queue);
};

export const createLock = (): {
  lock: () => Promise<void>;
  unlock: () => void;
} => {
  const queue: PromiseWithResolvers<void>[] = [];
  let locked = false;

  return {
    lock: async () => {
      if (locked === false) {
        locked = true;
        return;
      }

      const pwr = promiseWithResolvers<void>();
      queue.push(pwr);
      return pwr.promise;
    },
    unlock: () => {
      if (queue.length > 0) {
        const pwr = queue.shift()!;
        pwr.resolve();
      } else {
        locked = false;
      }
    },
  };
};
