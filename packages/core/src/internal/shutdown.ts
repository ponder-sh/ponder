export type Shutdown = {
  add: (callback: () => unknown | Promise<unknown>) => void;
  kill: () => Promise<void>;
  isKilled: boolean;
  abortController: AbortController;
};

export const createShutdown = (): Shutdown => {
  const abortController = new AbortController();
  const callbacks: (() => unknown | Promise<unknown>)[] = [];

  return {
    add: (callback) => {
      if (abortController.signal.aborted) {
        callback();
        return;
      }

      callbacks.push(callback);
    },
    kill: async () => {
      if (abortController.signal.aborted) return;

      abortController.abort();
      await Promise.all(callbacks.map((callback) => callback()));
    },
    get isKilled() {
      return abortController.signal.aborted;
    },
    abortController,
  };
};
