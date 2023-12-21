import path from "node:path";

import pc from "picocolors";
import { type LevelWithSilent, type Logger, pino } from "pino";

type LogOptions = { msg?: string; service?: string } & { [key: string]: any };

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});

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
        stream: {
          write(logString: string) {
            const log = JSON.parse(logString);
            const prettyLog = formatMessage(log);
            console.log(prettyLog);

            // If there is an "error" property, log the stack trace.
            if (log.error?.stack) console.log(log.error.stack);
            if (log.error?.meta) console.log(log.error.meta);

            // TODO: Consider also logging any inner `cause` errors.
            // if (log.error?.cause?.stack) {
            //   console.log("Details:");
            //   console.log("  " + log.error.cause.stack);
            // }
          },
        },
      });
    }

    if (dir) {
      const timestamp = new Date().toISOString().replace(/[-:.]/g, "_");
      const logFile = path.join(dir, `${timestamp}.log`);
      streams.push({
        level: "trace",
        stream: pino.destination({ dest: logFile, sync: false, mkdir: true }),
      });
    }

    this.logger = pino(
      {
        level: "trace",
        serializers: { error: pino.stdSerializers.errWithCause },
      },
      pino.multistream(streams),
    );
  }

  fatal = (options: LogOptions & { error?: Error }) => {
    this.logger.fatal(options);
  };
  error = (options: LogOptions & { error: Error; msg?: string }) => {
    this.logger.error(options);
  };
  warn = (options: LogOptions & { msg: string }) => {
    this.logger.warn(options);
  };
  info = (options: LogOptions & { msg: string }) => {
    this.logger.info(options);
  };
  debug = (options: LogOptions & { msg: string }) => {
    this.logger.debug(options);
  };
  trace = (options: LogOptions & { msg: string }) => {
    this.logger.trace(options);
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

  const timestamp = log.time as number;
  const time = timeFormatter.format(new Date(timestamp));
  const level = levels[(log.level as keyof typeof levels) ?? 30];
  const msg = log.msg as string | undefined;
  const errorMessage = log.error?.message as string | undefined;
  const message = msg ?? errorMessage;
  const service = log.service as string | undefined;

  result += pc.isColorSupported ? pc.gray(`${time} `) : `${time} `;
  result += pc.isColorSupported ? level.colorize(level.label) : level.label;
  if (service)
    result += pc.isColorSupported
      ? ` ${pc.cyan(service.padEnd(10, " "))}`
      : ` ${service.padEnd(10, " ")}`;
  result += pc.reset(` ${message}`);
  return result;
};
