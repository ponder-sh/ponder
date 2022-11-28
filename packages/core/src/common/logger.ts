export enum LogLevel {
  // Silent 0
  Error, // 1
  Info, // 2
  Warn, // 3
  Debug, // 4
  Trace, // 5
}

export type PonderLogger = {
  error: (message?: any, ...optionalParams: any[]) => void;
  info: (message?: any, ...optionalParams: any[]) => void;
  warn: (message?: any, ...optionalParams: any[]) => void;
  debug: (message?: any, ...optionalParams: any[]) => void;
  trace: (message?: any, ...optionalParams: any[]) => void;
};

// This is a hack for now because the options/config/etc approach is still
// a bit awkward. The only way to configure LOG_LEVEL is through the PONDER_LOG_LEVEL env var.

const LOG_LEVEL =
  process.env.PONDER_LOG_LEVEL != undefined
    ? Number(process.env.PONDER_LOG_LEVEL)
    : 2;

export const logger: PonderLogger = {
  error: (...args: Parameters<typeof console.log>) => {
    if (LOG_LEVEL > LogLevel.Error) console.log(...args);
  },
  info: (...args: Parameters<typeof console.log>) => {
    if (LOG_LEVEL > LogLevel.Info) console.log(...args);
  },
  warn: (...args: Parameters<typeof console.log>) => {
    if (LOG_LEVEL > LogLevel.Warn) console.log(...args);
  },
  debug: (...args: Parameters<typeof console.log>) => {
    if (LOG_LEVEL > LogLevel.Debug) console.log(...args);
  },
  trace: (...args: Parameters<typeof console.log>) => {
    if (LOG_LEVEL > LogLevel.Trace) console.log(...args);
  },
};
