/* eslint-disable @typescript-eslint/no-explicit-any */
import { CONFIG } from "./config";

enum LogLevel {
  Error,
  Info,
  Warn,
  Debug,
}

const logger = {
  error: (...args: any) => {
    if (CONFIG.logLevel === LogLevel.Error) console.log(...args);
  },
  info: (...args: any) => {
    if (CONFIG.logLevel === LogLevel.Info) console.log(...args);
  },
  warn: (...args: any) => {
    if (CONFIG.logLevel === LogLevel.Warn) console.log(...args);
  },
  debug: (...args: any) => {
    if (CONFIG.logLevel === LogLevel.Debug) console.log(...args);
  },
};

export { logger, LogLevel };
