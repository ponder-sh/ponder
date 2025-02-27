import type { Prettify } from "@/types/utils.js";
import pc from "picocolors";

export type LogMode = "pretty" | "json";
export type LogLevel =
  | "fatal"
  | "error"
  | "warn"
  | "info"
  | "debug"
  | "trace"
  | "silent";

export const levelKeyToValue = {
  silent: 100,
  fatal: 60,
  error: 50,
  warn: 40,
  info: 30,
  debug: 20,
  trace: 10,
} as const;

const levelValueToLabels = {
  60: { label: "FATAL", colorLabel: pc.bgRed("FATAL") },
  50: { label: "ERROR", colorLabel: pc.red("ERROR") },
  40: { label: "WARN ", colorLabel: pc.yellow("WARN ") },
  30: { label: "INFO ", colorLabel: pc.green("INFO ") },
  20: { label: "DEBUG", colorLabel: pc.blue("DEBUG") },
  10: { label: "TRACE", colorLabel: pc.gray("TRACE") },
} as const;

export type LogOptions = {
  msg: string;
  service?: string;
  error?: Error;
};

export type Log = Prettify<
  LogOptions & {
    level: 60 | 50 | 40 | 30 | 20 | 10;
    time: number;
  }
>;

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});

type ErrorLike = Error & { meta?: string[]; where?: string; cause?: unknown };

function sanitizeError(error: ErrorLike) {
  const seen = new Set<ErrorLike>();

  // Get full message including cause chain
  const messages: Set<string> = new Set();
  const stacks: Set<string> = new Set();
  const metas: Set<string> = new Set();

  let curr: ErrorLike | undefined = error;
  let depth = 0;
  while (curr && depth < 5) {
    if (seen.has(curr)) break;
    seen.add(curr);
    depth++;

    if (curr.message && typeof curr.message === "string")
      messages.add(curr.message);
    if (curr.stack && typeof curr.stack === "string") stacks.add(curr.stack);

    // Add "where" to meta
    if (curr.where && typeof curr.where === "string") metas.add(curr.where);

    const currMeta = Array.isArray(curr.meta) ? curr.meta : [curr.meta];
    for (const meta of currMeta) {
      if (typeof meta === "string") {
        metas.add(meta);
      }
    }

    curr = curr.cause as ErrorLike | undefined;
  }

  return {
    message: Array.from(messages).join(": "),
    stack: Array.from(stacks).join("\ncaused by:\n"),
    meta: metas.size > 0 ? Array.from(metas).join("\n") : undefined,
  };
}

export const formatLogJson = (log: Log): string => {
  return JSON.stringify({
    time: log.time,
    msg: log.msg,
    level: log.level,
    service: log.service,
    error: log.error ? sanitizeError(log.error) : undefined,
  });
};

export const formatLogPretty = (log: Log): string => {
  const time = timeFormatter.format(new Date(log.time));
  const levelLabels = levelValueToLabels[log.level ?? 30];

  let prettyLog: string[];
  if (pc.isColorSupported) {
    const level = levelLabels.colorLabel;
    const service = log.service ? pc.cyan(log.service.padEnd(10, " ")) : "";
    const messageText = pc.reset(log.msg);

    prettyLog = [`${pc.gray(time)} ${level} ${service} ${messageText}`];
  } else {
    const level = levelLabels.label;
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
