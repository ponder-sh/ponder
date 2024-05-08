import type { Prettify } from "@/types/utils.js";
import pc from "picocolors";
import { type DestinationStream, type LevelWithSilent, pino } from "pino";

export type LogMode = "pretty" | "structured";
export type LogLevel = Prettify<LevelWithSilent>;
export type Logger = ReturnType<typeof createLogger>;

type LogOptions = { msg: string; service: string } & { [key: string]: any };

export function createLogger({
  level,
  mode = "pretty",
}: { level: LogLevel; mode?: LogMode }) {
  const stream: DestinationStream = {
    write(logString: string) {
      if (mode === "structured") {
        // Remove trailing newline character. Note that this is bad for performance.
        console.log(logString.trimEnd());
        return;
      }

      const log = JSON.parse(logString);
      const prettyLog = format(log);
      console.log(prettyLog);

      // If there is an "error" property, log the stack trace.
      if (log.error) {
        const message = log.error.stack ?? log.error.message ?? log.error;
        console.log(message);
        if (typeof log.error?.meta === "string") console.log(log.error.meta);
        if (Array.isArray(log.error?.meta))
          console.log(log.error.meta.join("\n"));
      }
    },
  };

  const logger = pino(
    {
      level,
      serializers: { error: pino.stdSerializers.errWithCause },
      // Removes "pid" and "hostname" properties from the log.
      base: undefined,
    },
    stream,
  );

  return {
    fatal(options: LogOptions) {
      logger.fatal(options);
    },
    error(options: LogOptions & { error: Error }) {
      logger.error(options);
    },
    warn(options: LogOptions) {
      logger.warn(options);
    },
    info(options: LogOptions) {
      logger.info(options);
    },
    debug(options: LogOptions) {
      logger.debug(options);
    },
    trace(options: LogOptions) {
      logger.trace(options);
    },
    async kill() {
      // TODO: Ask kyle about this
      // return new Promise<void>((resolve, reject) => {
      //   logger.flush((error) => {
      //     if (error) {
      //       reject(error);
      //     } else {
      //       resolve();
      //     }
      //   });
      // }),
    },
  };
}

const levels = {
  60: { label: "FATAL", colorLabel: pc.bgRed("FATAL") },
  50: { label: "ERROR", colorLabel: pc.red("ERROR") },
  40: { label: "WARN ", colorLabel: pc.yellow("WARN ") },
  30: { label: "INFO ", colorLabel: pc.green("INFO ") },
  20: { label: "DEBUG", colorLabel: pc.blue("DEBUG") },
  10: { label: "TRACE", colorLabel: pc.gray("TRACE") },
} as const;

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});

const format = (log: LogOptions) => {
  const time = timeFormatter.format(new Date(log.time));
  const message = log.msg ?? log.error?.message;

  const levelObject =
    levels[(log.level as keyof typeof levels) ?? 30] ?? levels[30];

  if (pc.isColorSupported) {
    const level = levelObject.colorLabel;
    const service = log.service ? pc.cyan(log.service.padEnd(10, " ")) : "";
    const messageText = pc.reset(message);
    return `${pc.gray(time)} ${level} ${service} ${messageText}`;
  } else {
    const level = levelObject.label;
    const service = log.service ? log.service.padEnd(10, " ") : "";
    return `${time} ${level} ${service} ${message}`;
  }
};
