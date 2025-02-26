import { parentPort, workerData } from "node:worker_threads";
import { type Log, formatLogJson, formatLogPretty } from "./logger-utils.js";

if (parentPort === null) {
  throw new Error("parentPort is null");
}

function validateMode(mode: any): "pretty" | "json" {
  if (mode !== "pretty" && mode !== "json")
    throw new Error(`Invalid log mode: ${mode}`);
  return mode;
}

const mode = validateMode(workerData.mode);

parentPort.on("message", (log: Log) => {
  try {
    const formatted =
      mode === "json" ? formatLogJson(log) : formatLogPretty(log);
    console.log(formatted);
  } catch (error) {
    const errorLog = {
      time: Date.now(),
      level: 50 as const,
      service: "logger",
      msg: "Logger formatting error",
      error: error as Error,
    };

    const formatted =
      mode === "json" ? formatLogJson(errorLog) : formatLogPretty(errorLog);
    console.log(formatted);
  }
});
