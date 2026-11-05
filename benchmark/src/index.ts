import { readFileSync } from "node:fs";
import { Command } from "commander";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Effect, Fiber, Layer, Logger, References } from "effect";
import { startApp } from "../../packages/core/src/bin/commands/start.js";
import { createLogger } from "../../packages/core/src/internal/logger.js";
import {
  Metrics,
  MetricsService,
} from "../../packages/core/src/internal/metrics.js";
import {
  buildOptions,
  Options,
} from "../../packages/core/src/internal/options.js";

const packageJson = JSON.parse(
  readFileSync(
    new URL("../../packages/core/package.json", import.meta.url),
    "utf8",
  ),
) as { version: string };

const APP_ID = process.argv[2];
const APP_DIR = `./apps/${APP_ID}`;
const DATABASE_URL = `${process.env.DATABASE_URL!}/benchmark_${APP_ID}`;
const SCHEMA = "benchmark";

export const DB = drizzle(DATABASE_URL!, { casing: "snake_case" });

await DB.execute(sql.raw(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`));

// TODO(kyle) metadata

const program = new Command()
  .option(
    "-v, --debug",
    "Enable debug logs, e.g. realtime blocks, internal events",
  )
  .option(
    "-vv, --trace",
    "Enable trace logs, e.g. db queries, indexing checkpoints",
  )
  .option(
    "--log-level <LEVEL>",
    'Minimum log level ("error", "warn", "info", "debug", or "trace", default: "info")',
  )
  .option(
    "--log-format <FORMAT>",
    'The log format ("pretty" or "json")',
    "pretty",
  )
  .parse(process.argv);

process.env.PONDER_TELEMETRY_DISABLED = "true";
process.env.DATABASE_URL = DATABASE_URL;
process.env.DATABASE_SCHEMA = SCHEMA;

const cliOptions = {
  ...program.optsWithGlobals(),
  command: "start" as const,
  version: packageJson.version,
  root: APP_DIR,
  config: "ponder.config.ts",
};
const options = buildOptions({ cliOptions });

/** Resolves to the time (unix ms) of the log that `/ready` returns 200. */
const ready = Promise.withResolvers<number>();
const readyLogger = Logger.make(({ message, date }) => {
  const [first] = message as [unknown];
  if (
    typeof first === "object" &&
    first !== null &&
    "msg" in first &&
    first.msg === "Started returning 200 responses" &&
    "endpoint" in first &&
    first.endpoint === "/ready"
  ) {
    ready.resolve(date.getTime());
  }
});

const services = Layer.mergeAll(
  Layer.succeed(Options, options),
  Layer.succeed(Metrics, new MetricsService()),
  Logger.layer([
    createLogger({ level: options.logLevel, mode: options.logFormat }),
    readyLogger,
  ]),
  // Note: The ready log is at `info`. The logger of Ponder drops logs under
  // the log level.
  Layer.succeed(
    References.MinimumLogLevel,
    options.logLevel === "debug"
      ? "Debug"
      : options.logLevel === "trace"
        ? "Trace"
        : "Info",
  ),
);

const startTimestamp = Date.now();

const fiber = Effect.runFork(
  Effect.scoped(startApp({ cliOptions })).pipe(Effect.provide(services)),
);
fiber.addObserver(() => ready.reject(new Error("Ponder exited")));

const endTimestamp = await ready.promise;

console.log(`${APP_ID} took ${endTimestamp - startTimestamp}ms`);

console.log("Stopping app");

await Effect.runPromise(Fiber.interrupt(fiber));
process.exit(0);
