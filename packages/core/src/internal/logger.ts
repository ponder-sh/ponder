import type { Prettify } from "@/types/utils.js";
import { formatEta } from "@/utils/format.js";
import pc from "picocolors";
import { type DestinationStream, type LevelWithSilent, pino } from "pino";

export type LogMode = "pretty" | "json";
export type LogLevel = Prettify<LevelWithSilent>;
export type Logger = {
  error<T extends Omit<Log, "level" | "time">>(
    options: T,
    printKeys?: (keyof T)[],
  ): void;
  warn<T extends Omit<Log, "level" | "time">>(
    options: T,
    printKeys?: (keyof T)[],
  ): void;
  info<T extends Omit<Log, "level" | "time">>(
    options: T,
    printKeys?: (keyof T)[],
  ): void;
  debug<T extends Omit<Log, "level" | "time">>(
    options: T,
    printKeys?: (keyof T)[],
  ): void;
  trace<T extends Omit<Log, "level" | "time">>(
    options: T,
    printKeys?: (keyof T)[],
  ): void;
  child: (bindings: Record<string, unknown>) => Logger;
  flush(): Promise<void>;
};

type Log = {
  // Pino properties
  level: 50 | 40 | 30 | 20 | 10;
  time: number;

  msg: string;

  duration?: number;
  error?: Error;
} & Record<string, unknown>;

const PRINT_KEYS = "PRINT_KEYS";
const INTERNAL_KEYS = [
  "level",
  "time",
  "msg",
  "duration",
  "error",
  "chain_id",
  PRINT_KEYS,
];

export function createLogger({
  level,
  mode = "pretty",
}: { level: LogLevel; mode?: LogMode }) {
  const stream: DestinationStream = {
    write(logString: string) {
      const log = JSON.parse(logString) as Log;
      const prettyLog = format(log);
      console.log(prettyLog);
    },
  };

  const _createLogger = (logger: pino.Logger): Logger => {
    return {
      error<T extends Omit<Log, "level" | "time">>(
        options: T,
        printKeys?: (keyof T)[],
      ) {
        if (mode === "pretty" && printKeys) {
          // @ts-ignore
          options[PRINT_KEYS] = printKeys;
        }
        logger.error(options);
      },
      warn<T extends Omit<Log, "level" | "time">>(
        options: T,
        printKeys?: (keyof T)[],
      ) {
        if (mode === "pretty" && printKeys) {
          // @ts-ignore
          options[PRINT_KEYS] = printKeys;
        }
        logger.warn(options);
      },
      info<T extends Omit<Log, "level" | "time">>(
        options: T,
        printKeys?: (keyof T)[],
      ) {
        if (mode === "pretty" && printKeys) {
          // @ts-ignore
          options[PRINT_KEYS] = printKeys;
        }
        logger.info(options);
      },
      debug<T extends Omit<Log, "level" | "time">>(
        options: T,
        printKeys?: (keyof T)[],
      ) {
        if (mode === "pretty" && printKeys) {
          // @ts-ignore
          options[PRINT_KEYS] = printKeys;
        }
        logger.debug(options);
      },
      trace<T extends Omit<Log, "level" | "time">>(
        options: T,
        printKeys?: (keyof T)[],
      ) {
        if (mode === "pretty" && printKeys) {
          // @ts-ignore
          options[PRINT_KEYS] = printKeys;
        }
        logger.trace(options);
      },
      child: (bindings) => _createLogger(logger.child(bindings)),
      // @ts-expect-error
      flush: () => new Promise<void>(logger.flush),
    };
  };

  const errorSerializer = pino.stdSerializers.wrapErrorSerializer((error) => {
    error.meta = Array.isArray(error.meta) ? error.meta.join("\n") : error.meta;
    // @ts-ignore
    error.type = undefined;
    return error;
  });

  let logger: pino.Logger;

  if (mode === "pretty") {
    logger = pino(
      {
        level,
        serializers: { error: errorSerializer },
        // Removes "pid" and "hostname" properties from the log.
        base: undefined,
      },
      stream,
    );
  } else {
    logger = pino({
      level,
      serializers: { error: errorSerializer },
      // Removes "pid" and "hostname" properties from the log.
      base: undefined,
    });
  }

  return _createLogger(logger);
}

export function createNoopLogger(
  _args: { level?: LogLevel; mode?: LogMode } = {},
) {
  return {
    error(_options: Omit<Log, "level" | "time">) {},
    warn(_options: Omit<Log, "level" | "time">) {},
    info(_options: Omit<Log, "level" | "time">) {},
    debug(_options: Omit<Log, "level" | "time">) {},
    trace(_options: Omit<Log, "level" | "time">) {},
    flush: () => new Promise<unknown>((resolve) => resolve(undefined)),
  };
}

const levels = {
  50: { label: "ERROR", colorLabel: pc.red("ERROR") },
  40: { label: "WARN ", colorLabel: pc.yellow("WARN ") },
  30: { label: "INFO ", colorLabel: pc.green("INFO ") },
  20: { label: "DEBUG", colorLabel: pc.blue("DEBUG") },
  10: { label: "TRACE", colorLabel: pc.gray("TRACE") },
} as const;

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  fractionalSecondDigits: 3,
  hour12: false,
});

const format = (log: Log) => {
  const time = timeFormatter.format(new Date(log.time));
  const levelObject = levels[log.level ?? 30];

  let prettyLog: string[];
  if (pc.isColorSupported) {
    const level = levelObject.colorLabel;
    const messageText = pc.reset(log.msg);

    let keyText = "";
    if (PRINT_KEYS in log) {
      for (const key of log[PRINT_KEYS] as (keyof Log)[]) {
        keyText += ` ${key}=${log[key]}`;
      }
    } else {
      for (const key of Object.keys(log)) {
        if (INTERNAL_KEYS.includes(key)) continue;
        keyText += ` ${key}=${log[key]}`;
      }
    }

    let durationText = "";
    if (log.duration) {
      durationText = ` ${pc.gray(`(${formatEta(log.duration)})`)}`;
    }

    prettyLog = [
      `${pc.dim(time)} ${level} ${messageText}${pc.dim(keyText)}${durationText}`,
    ];
  } else {
    const level = levelObject.label;

    let keyText = "";
    if (PRINT_KEYS in log) {
      keyText = (log[PRINT_KEYS] as (keyof Log)[])
        .map((key) => ` ${key}=${log[key]}`)
        .join("");
    } else {
      for (const key of Object.keys(log)) {
        if (INTERNAL_KEYS.includes(key)) continue;
        keyText += ` ${key}=${log[key]}`;
      }
    }

    let durationText = "";
    if (log.duration) {
      durationText = ` (${formatEta(log.duration)})`;
    }

    prettyLog = [`${time} ${level} ${log.msg}${keyText}${durationText}`];
  }

  if (log.error) {
    if (log.error.stack) {
      prettyLog.push(log.error.stack);
    } else {
      prettyLog.push(`${log.error.name}: ${log.error.message}`);
    }

    if (typeof log.error === "object" && "where" in log.error) {
      prettyLog.push(`where: ${log.error.where as string}`);
    }
    if (typeof log.error === "object" && "meta" in log.error) {
      prettyLog.push(log.error.meta as string);
    }
  }
  return prettyLog.join("\n");
};
