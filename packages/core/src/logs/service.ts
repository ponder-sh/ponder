import path from "node:path";
import pino, { type Logger, type LevelWithSilent } from "pino";
import pretty from "pino-pretty";
import pc from "picocolors";

type LogFunctionArgs =
  | [string]
  | [{ msg: string; service?: string } & { [key: string]: any }]
  | [string, { service?: string } & { [key: string]: any }];

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
          // Exclude all properties from default formatting provided by `pino-pretty`.
          // All structured properties will still be included in the log file.
          include: "",
          messageFormat: formatMessage,
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

const levels = {
  60: { label: "FATAL", colorize: (s: string) => pc.bgRed(s) },
  50: { label: "ERROR", colorize: (s: string) => pc.red(s) },
  40: { label: "WARN ", colorize: (s: string) => pc.yellow(s) },
  30: { label: "INFO ", colorize: (s: string) => pc.green(s) },
  20: { label: "DEBUG", colorize: (s: string) => pc.blue(s) },
  10: { label: "TRACE", colorize: (s: string) => pc.gray(s) },
} as const;

const formatMessage = (log: { [key: string]: any }) => {
  let result = "";

  const timestamp = log["time"] as number;
  const level = levels[(log["level"] as keyof typeof levels) ?? 30];
  const message = log["msg"] as string | undefined;
  const service = log["service"] as string | undefined;

  const date = new Date(timestamp);
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");
  const millis = String(date.getUTCMilliseconds()).padStart(3, "0");
  const time = `${hours}:${minutes}:${seconds}.${millis} `;

  result += pc.isColorSupported ? pc.gray(time) : time;

  result += pc.isColorSupported ? level.colorize(level.label) : level.label;

  if (service) {
    result += pc.isColorSupported
      ? " " + pc.cyan(service.padEnd(10, " "))
      : " " + service.padEnd(10, " ");
  }

  result += pc.reset(` ${message}`);

  return result;
};
