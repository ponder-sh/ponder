import pico from "picocolors";

/**
 * Log levels:
 * 0 -> silent
 * 1 -> error
 * 2 -> info
 * 3 -> warn
 * 4 -> debug
 * 5 -> trace
 */

export class LoggerService {
  logLevel: number;

  constructor({ options }: { options: { logLevel: number } }) {
    this.logLevel = options.logLevel;
  }

  error = (...args: Parameters<typeof console.log>) => {
    if (this.logLevel > 0) console.log(...args);
  };
  info = (...args: Parameters<typeof console.log>) => {
    if (this.logLevel > 1) console.log(...args);
  };
  warn = (...args: Parameters<typeof console.log>) => {
    if (this.logLevel > 2) console.log(...args);
  };
  debug = (...args: Parameters<typeof console.log>) => {
    if (this.logLevel > 3) console.log(...args);
  };
  trace = (...args: Parameters<typeof console.log>) => {
    if (this.logLevel > 4) console.log(...args);
  };

  private maxWidth = 0;
  // This function is specifically for message logs.
  logMessage(
    kind: "event" | "error" | "warning" | "historical" | "realtime" | "indexer",
    message: string
  ) {
    this.maxWidth = Math.max(this.maxWidth, kind.length);
    const padded = kind.padEnd(this.maxWidth, " ");

    switch (kind) {
      case "event": {
        this.info(pico.magenta(padded) + " - " + message);
        break;
      }
      case "error": {
        this.error(pico.red(padded) + " - " + message);
        break;
      }
      case "warning": {
        this.error(pico.yellow(padded) + " - " + message);
        break;
      }
      case "historical": {
        this.info(pico.yellow(padded) + " - " + message);
        break;
      }
      case "realtime": {
        this.info(pico.cyan(padded) + " - " + message);
        break;
      }
      case "indexer": {
        this.info(pico.blue(padded) + " - " + message);
        break;
      }
    }
  }
}
