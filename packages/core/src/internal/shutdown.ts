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
      callbacks.push(callback);
    },
    kill: async () => {
      abortController.abort();
      await Promise.all(callbacks.map((callback) => callback()));
    },
    get isKilled() {
      return abortController.signal.aborted;
    },
    abortController,
  };
};
