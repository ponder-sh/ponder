import pico from "picocolors";

import { PonderOptions } from "../config/options";

export enum LogLevel {
  // Silent 0
  Error, // 1
  Info, // 2
  Warn, // 3
  Debug, // 4
  Trace, // 5
}

export enum MessageKind {
  EVENT = "event",
  ERROR = "error",
  WARNING = "warning",
  BACKFILL = "backfill",
  FRONTFILL = "frontfill",
  INDEXER = "indexer",
}

export class LoggerService {
  isSilent: boolean;

  constructor({ options }: { options: PonderOptions }) {
    this.isSilent = options.SILENT;
  }

  error = (...args: Parameters<typeof console.log>) => {
    if (!this.isSilent && this.getLogLevel() > LogLevel.Error)
      console.log(...args);
  };
  info = (...args: Parameters<typeof console.log>) => {
    if (!this.isSilent && this.getLogLevel() > LogLevel.Info)
      console.log(...args);
  };
  warn = (...args: Parameters<typeof console.log>) => {
    if (!this.isSilent && this.getLogLevel() > LogLevel.Warn)
      console.log(...args);
  };
  debug = (...args: Parameters<typeof console.log>) => {
    if (!this.isSilent && this.getLogLevel() > LogLevel.Debug)
      console.log(...args);
  };
  trace = (...args: Parameters<typeof console.log>) => {
    if (!this.isSilent && this.getLogLevel() > LogLevel.Trace)
      console.log(...args);
  };

  private getLogLevel = () => {
    // This is a hack for now because the options/config/etc approach is still
    // a bit awkward. The only way to configure LOG_LEVEL is through the PONDER_LOG_LEVEL env var.
    return process.env.PONDER_LOG_LEVEL != undefined
      ? Number(process.env.PONDER_LOG_LEVEL)
      : 2;
  };

  private maxWidth = 0;
  // This function is specifically for message logs.
  logMessage(kind: MessageKind, message: string) {
    this.maxWidth = Math.max(this.maxWidth, kind.length);
    const padded = kind.padEnd(this.maxWidth, " ");

    switch (kind) {
      case MessageKind.EVENT: {
        this.info(pico.magenta(padded) + " - " + message);
        break;
      }
      case MessageKind.ERROR: {
        this.error(pico.red(padded) + " - " + message);
        break;
      }
      case MessageKind.WARNING: {
        this.error(pico.yellow(padded) + " - " + message);
        break;
      }
      case MessageKind.BACKFILL: {
        this.info(pico.yellow(padded) + " - " + message);
        break;
      }
      case MessageKind.FRONTFILL: {
        this.info(pico.cyan(padded) + " - " + message);
        break;
      }
      case MessageKind.INDEXER: {
        this.info(pico.blue(padded) + " - " + message);
        break;
      }
    }
  }
}
