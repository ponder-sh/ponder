import {
  type Cause,
  Effect,
  type LogLevel as EffectLogLevel,
  Layer,
  Logger,
  References,
} from "effect";
import pc from "picocolors";
import { type DestinationStream, type LevelWithSilent, pino } from "pino";
import type { Prettify } from "@/types/utils.js";
import { formatEta } from "@/utils/format.js";

export type LogMode = "pretty" | "json";
export type LogLevel = Prettify<LevelWithSilent>;

/**
 * The structured message of a log.
 *
 * @example
 * ```ts
 * yield* Effect.logInfo({ msg: "Indexed block", chain: "mainnet", number: 1 });
 * // Only print `chain` in pretty mode
 * yield* Effect.logInfo({ msg: "Indexed block", chain: "mainnet", number: 1 }, ["chain"]);
 * // Add `action=migrate` to each log
 * yield* migrate.pipe(Effect.annotateLogs({ action: "migrate" }));
 * ```
 */
export type LogMessage = {
  msg: string;
  duration?: number;
  error?: Error;
} & Record<string, unknown>;

type Log = {
  // Pino properties
  level: 50 | 40 | 30 | 20 | 10;
  time: number;
} & LogMessage;

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

const minimumLogLevels = {
  silent: "None",
  fatal: "Fatal",
  error: "Error",
  warn: "Warn",
  info: "Info",
  debug: "Debug",
  trace: "Trace",
} as const satisfies Record<LogLevel, EffectLogLevel.LogLevel>;

const pinoLevels = {
  Fatal: "fatal",
  Error: "error",
  Warn: "warn",
  Info: "info",
  Debug: "debug",
  Trace: "trace",
} as const satisfies Record<EffectLogLevel.Severity, LevelWithSilent>;

/**
 * Create a logger that writes Effect logs with Ponder's format.
 *
 * @dev The first message of a log is a {@link LogMessage}, and the optional
 * second message is the keys to print in pretty mode. Log annotations are
 * written before the message keys, like pino child bindings.
 */
export function createLogger({
  level,
  mode = "pretty",
}: {
  level: LogLevel;
  mode?: LogMode;
}): Logger.Logger<unknown, void> {
  const stream: DestinationStream = {
    write(logString: string) {
      const log = JSON.parse(logString) as Log;
      const prettyLog = format(log);
      console.log(prettyLog);
    },
  };

  const errorSerializer = pino.stdSerializers.wrapErrorSerializer((error) => {
    error.meta = Array.isArray(error.meta) ? error.meta.join("\n") : error.meta;
    // @ts-expect-error
    error.type = undefined;
    return error;
  });

  let logger: pino.Logger;
  /** The time of the log being written, from the `Clock` of its fiber. */
  let time = 0;
  const timestamp = () => `,"time":${time}`;

  if (mode === "pretty") {
    logger = pino(
      {
        level,
        serializers: { error: errorSerializer },
        // Removes "pid" and "hostname" properties from the log.
        base: undefined,
        timestamp,
      },
      stream,
    );
  } else {
    logger = pino({
      level,
      serializers: { error: errorSerializer },
      // Removes "pid" and "hostname" properties from the log.
      base: undefined,
      timestamp,
    });
  }

  return Logger.make(({ message, logLevel, cause, fiber, date }) => {
    if (logLevel === "All" || logLevel === "None") return;
    time = date.getTime();

    const [first, printKeys] = message as [unknown, string[] | undefined];

    let options: Record<string, unknown> =
      typeof first === "object" && first !== null
        ? (first as Record<string, unknown>)
        : { msg: String(first) };

    if (options.error === undefined && cause.reasons.length > 0) {
      options = { ...options, error: causeError(cause) };
    }

    const annotations = fiber.getRef(References.CurrentLogAnnotations);
    for (const _ in annotations) {
      options = { ...annotations, ...options };
      break;
    }

    if (mode === "pretty" && printKeys) {
      options[PRINT_KEYS] = printKeys;
    }

    logger[pinoLevels[logLevel]](options);
  });
}

const causeError = (cause: Cause.Cause<unknown>): unknown => {
  const reason = cause.reasons[0]!;
  if (reason._tag === "Fail") return reason.error;
  if (reason._tag === "Die") return reason.defect;
  return new Error("Interrupted");
};

/**
 * Layer that writes logs with Ponder's format at `level` and above.
 */
export const layerLogger = (options: {
  level: LogLevel;
  mode?: LogMode;
}): Layer.Layer<never> =>
  Layer.mergeAll(
    Logger.layer([createLogger(options)]),
    Layer.succeed(References.MinimumLogLevel, minimumLogLevels[options.level]),
  );

/**
 * Write a log from a callback outside a fiber, such as an event handler.
 */
export type LogUnsafe = (log: Effect.Effect<void>) => void;

/**
 * Capture the loggers and log annotations of the current fiber for callbacks
 * outside a fiber. Logs are written synchronously.
 */
export const makeLogUnsafe: Effect.Effect<LogUnsafe> = Effect.map(
  Effect.context<never>(),
  (context) => Effect.runSyncWith(context),
);

/**
 * Layer that discards logs.
 */
export const layerNoopLogger: Layer.Layer<never> = Layer.mergeAll(
  Logger.layer([]),
  Layer.succeed(References.MinimumLogLevel, "None"),
);

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
