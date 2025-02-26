import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import {
  type Log,
  type LogLevel,
  type LogMode,
  type LogOptions,
  formatLogJson,
  formatLogPretty,
  levelKeyToValue,
} from "./logger-utils.js";

export type Logger = ReturnType<typeof createLogger>;

export function createLogger({
  level,
  mode = "pretty",
  useWorker = false,
}: {
  level: LogLevel;
  mode?: LogMode;
  useWorker?: boolean;
}) {
  let worker: Worker | undefined = undefined;
  let workerTerminatePromise: Promise<number> | undefined = undefined;
  let shouldUseWorker = useWorker;

  const handleWorkerError = (error: Error) => {
    workerTerminatePromise = worker?.terminate();
    shouldUseWorker = false;

    const errorLog = {
      time: Date.now(),
      level: 50 as const,
      service: "logger",
      msg: "Logger worker error, falling back to main thread",
      error: error as Error,
    };

    const formatted =
      mode === "json" ? formatLogJson(errorLog) : formatLogPretty(errorLog);
    console.log(formatted);
  };

  if (useWorker) {
    const __dirname = fileURLToPath(new URL(".", import.meta.url));
    const workerFilePath = path.join(__dirname, "logger-worker.js");
    worker = new Worker(workerFilePath, { workerData: { mode: mode } });
    worker.on("error", handleWorkerError);
  }

  const write = (log: Log) => {
    if (shouldUseWorker) {
      try {
        worker?.postMessage(log);
        if (Math.random() < 0.01) {
          throw new Error("simulate worker error");
        }
      } catch (error) {
        handleWorkerError(error as Error);
      }
    } else {
      const formatted =
        mode === "json" ? formatLogJson(log) : formatLogPretty(log);
      console.log(formatted);
    }
  };

  const levelValue = levelKeyToValue[level];

  return {
    fatal(options: LogOptions) {
      if (levelValue <= 60) write({ ...options, time: Date.now(), level: 60 });
    },
    error(options: LogOptions) {
      if (levelValue <= 50) write({ ...options, time: Date.now(), level: 50 });
    },
    warn(options: LogOptions) {
      if (levelValue <= 40) write({ ...options, time: Date.now(), level: 40 });
    },
    info(options: LogOptions) {
      if (levelValue <= 30) write({ ...options, time: Date.now(), level: 30 });
    },
    debug(options: LogOptions) {
      if (levelValue <= 20) write({ ...options, time: Date.now(), level: 20 });
    },
    trace(options: LogOptions) {
      if (levelValue <= 10) write({ ...options, time: Date.now(), level: 10 });
    },
    flush: async () => {
      if (workerTerminatePromise !== undefined) {
        await workerTerminatePromise;
      } else {
        await worker?.terminate();
      }
    },
  };
}
