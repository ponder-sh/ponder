import path from "node:path";
import pino, { type Logger, type LevelWithSilent } from "pino";
import pretty from "pino-pretty";

type LogFunctionArgs =
  | [obj: object, msg?: string, ...args: any[]]
  | [obj: unknown, msg?: string, ...args: any[]]
  | [msg: string, ...args: any[]];

export class LoggerService {
  private logger: Logger;

  constructor({
    level = "info",
    dir,
  }: { level?: LevelWithSilent; dir?: string } = {}) {
    const streams: (pino.DestinationStream | pino.StreamEntry)[] = [];

    if (level !== "silent") {
      streams.push({
        level,
        stream: pretty({
          // Write logs in the main thread (worse performance, better DX).
          sync: true,
          // Only include the level, time, and msg properties.
          // All structured properties will still be included in the log file.
          include: "level,time",
          // Use UTC timestamps rather than local (the default).
          translateTime: "UTC:HH:MM:ss.l",
          customPrettifiers: {
            // Remove the default enclosing brackets.
            time: (timestamp) => `${timestamp}`,
          },
        }),
      });
    }

    if (dir) {
      const logFile = path.join(dir, `${new Date().toISOString()}.log`);
      streams.push({
        level: "trace",
        stream: pino.destination({ dest: logFile, sync: false, mkdir: true }),
      });
    }

    this.logger = pino({ level: "trace" }, pino.multistream(streams));
  }

  fatal = (...args: LogFunctionArgs) => {
    this.logger.fatal(...(args as [any]));
  };
  error = (...args: LogFunctionArgs) => {
    this.logger.error(...(args as [any]));
  };
  warn = (...args: LogFunctionArgs) => {
    this.logger.warn(...(args as [any]));
  };
  info = (...args: LogFunctionArgs) => {
    this.logger.info(...(args as [any]));
  };
  debug = (...args: LogFunctionArgs) => {
    this.logger.debug(...(args as [any]));
  };
  trace = (...args: LogFunctionArgs) => {
    this.logger.trace(...(args as [any]));
  };
}
