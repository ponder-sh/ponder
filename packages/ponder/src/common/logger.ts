import { CONFIG } from "@/common/config";

enum LogLevel {
  // Silent 0
  Error, // 1
  Info, // 2
  Warn, // 3
  Debug, // 4
  Trace, // 5
}

const logger = {
  error: (...args: Parameters<typeof console.log>) => {
    if (CONFIG.LOG_LEVEL > LogLevel.Error) console.log(...args);
  },
  info: (...args: Parameters<typeof console.log>) => {
    if (CONFIG.LOG_LEVEL > LogLevel.Info) console.log(...args);
  },
  warn: (...args: Parameters<typeof console.log>) => {
    if (CONFIG.LOG_LEVEL > LogLevel.Warn) console.log(...args);
  },
  debug: (...args: Parameters<typeof console.log>) => {
    if (CONFIG.LOG_LEVEL > LogLevel.Debug) console.log(...args);
  },
  trace: (...args: Parameters<typeof console.log>) => {
    if (CONFIG.LOG_LEVEL > LogLevel.Trace) console.log(...args);
  },
};

export { logger, LogLevel };
