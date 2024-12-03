import type { Prettify } from "@/types/utils.js";
import pc from "picocolors";
import { type DestinationStream, type LevelWithSilent, pino } from "pino";

export type LogMode = "pretty" | "json";
export type LogLevel = Prettify<LevelWithSilent>;
export type Logger = ReturnType<typeof createLogger>;

type Log = {
  // Pino properties
  level: 60 | 50 | 40 | 30 | 20 | 10;
  time: number;

  service: string;
  msg: string;

  error?: Error;
};

export function createLogger({
  level,
  mode = "pretty",
}: { level: LogLevel; mode?: LogMode }) {
  const stream: DestinationStream = {
    write(logString: string) {
      if (mode === "json") {
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
      serializers: {
        error: pino.stdSerializers.wrapErrorSerializer((error) => {
          error.meta = Array.isArray(error.meta)
            ? error.meta.join("\n")
            : error.meta;
          //@ts-ignore
          error.type = undefined;
          return error;
        }),
      },
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

  let prettyLog: string[];
  if (pc.isColorSupported) {
    const level = levelObject.colorLabel;
    const service = log.service ? pc.cyan(log.service.padEnd(10, " ")) : "";
    const messageText = pc.reset(log.msg);

    prettyLog = [`${pc.gray(time)} ${level} ${service} ${messageText}`];
  } else {
    const level = levelObject.label;
    const service = log.service ? log.service.padEnd(10, " ") : "";

    prettyLog = [`${time} ${level} ${service} ${log.msg}`];
  }

  if (log.error) {
    if (log.error.stack) {
      prettyLog.push(log.error.stack);
    } else {
      prettyLog.push(`${log.error.name}: ${log.error.message}`);
    }

    if ("where" in log.error) {
      prettyLog.push(`where: ${log.error.where as string}`);
    }
    if ("meta" in log.error) {
      prettyLog.push(log.error.meta as string);
    }
  }
  return prettyLog.join("\n");
};
