/**
 * Create a lock for promises, which grants the lock in the order of `lock` calls.
 */
export const createLock = (): {
  lock: () => Promise<void>;
  unlock: () => void;
} => {
  const queue: (() => void)[] = [];
  let locked = false;

  return {
    lock: () => {
      if (locked === false) {
        locked = true;
        return Promise.resolve();
      }

      return new Promise<void>((resolve) => queue.push(resolve));
    },
    unlock: () => {
      const next = queue.shift();
      if (next) {
        next();
      } else {
        locked = false;
      }
    },
  };
};
