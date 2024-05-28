import type { Prettify } from "@/types/utils.js";
import pc from "picocolors";
import { type DestinationStream, type LevelWithSilent, pino } from "pino";

export type LogMode = "pretty" | "structured";
export type LogLevel = Prettify<LevelWithSilent>;
export type Logger = ReturnType<typeof createLogger>;

type Log = {
  // Pino properties
  level: 60 | 50 | 40 | 30 | 20 | 10;
  time: number;

  service: string;
  msg: string;

  // Error
  errorName?: string;
  errorMessage?: string;
  errorStack?: string;
  errorHints?: string[];
};

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

      const log = JSON.parse(logString) as Log;
      const prettyLog = format(log);
      console.log(prettyLog);
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
    fatal(options: Omit<Log, "level" | "time">) {
      logger.fatal(options);
    },
    error(options: Omit<Log, "level" | "time">) {
      logger.error(options);
    },
    warn(options: Omit<Log, "level" | "time">) {
      logger.warn(options);
    },
    info(options: Omit<Log, "level" | "time">) {
      logger.info(options);
    },
    debug(options: Omit<Log, "level" | "time">) {
      logger.debug(options);
    },
    trace(options: Omit<Log, "level" | "time">) {
      logger.trace(options);
    },
    async kill() {},
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

const format = (log: Log) => {
  const time = timeFormatter.format(new Date(log.time));

  const levelObject = levels[log.level ?? 30];

  if (log.errorMessage) console.log(log.errorMessage);
  if (log.errorHints) console.log(`Hints:\n ${log.errorHints.join("\n")}`);
  if (log.errorStack) console.log(log.errorStack);

  if (pc.isColorSupported) {
    const level = levelObject.colorLabel;
    const service = log.service ? pc.cyan(log.service.padEnd(10, " ")) : "";
    const messageText = pc.reset(log.msg);
    return `${pc.gray(time)} ${level} ${service} ${messageText}`;
  } else {
    const level = levelObject.label;
    const service = log.service ? log.service.padEnd(10, " ") : "";
    return `${time} ${level} ${service} ${log.msg}`;
  }
};
