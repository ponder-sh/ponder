import { readFileSync } from "node:fs";
import path from "node:path";
import { Effect, Exit, Fiber, Layer, Logger, References } from "effect";
import pg from "pg";
import { startApp } from "../../packages/core/src/bin/commands/start.js";
import type { CliOptions } from "../../packages/core/src/bin/ponder.js";
import {
  createLogger,
  layerLogger,
} from "../../packages/core/src/internal/logger.js";
import {
  Metrics,
  MetricsService,
} from "../../packages/core/src/internal/metrics.js";
import {
  buildOptions,
  Options,
} from "../../packages/core/src/internal/options.js";
import type { Plan } from "../../simulation-test/src/plan.js";
import type { Stats } from "../../simulation-test/src/serve.js";

export const version = (
  JSON.parse(
    readFileSync(
      new URL("../../packages/core/package.json", import.meta.url),
      "utf8",
    ),
  ) as { version: string }
).version;

const benchmarkLogger = layerLogger({ level: "info" });

/**
 * Log an event of the benchmark, in the format of Ponder, whatever the log
 * level of Ponder.
 */
export const log = (
  fields: { msg: string; [key: string]: unknown },
  level: "info" | "error" = "info",
) =>
  Effect.runSync(
    (level === "info" ? Effect.logInfo : Effect.logError)({
      service: "benchmark",
      ...fields,
    }).pipe(Effect.provide(benchmarkLogger)),
  );

/** The fields of a log of Ponder, such as `msg`. */
export type Log = { msg?: string; [key: string]: unknown };

/**
 * Run `ponder start` in this process, with a logger that also passes each
 * log of Ponder, at `info` and above, to `onLog`.
 *
 * @returns `ready`, which resolves to the time (unix ms) when `/ready`
 * returned 200, `exited`, which resolves when Ponder exits, and `stop`.
 */
export const runPonder = ({
  cliOptions,
  onLog = () => {},
}: {
  cliOptions: Partial<CliOptions> & { root: string };
  onLog?: (log: Log, time: number) => void;
}) => {
  const fullOptions: CliOptions = {
    logFormat: "pretty",
    ...cliOptions,
    command: "start",
    version,
    config: "ponder.config.ts",
  };
  const options = buildOptions({ cliOptions: fullOptions });

  const ready = Promise.withResolvers<number>();
  const logger = Logger.make(({ message, date }) => {
    const [first] = message as [unknown];
    if (typeof first !== "object" || first === null) return;
    const log = first as Log;
    if (
      log.msg === "Started returning 200 responses" &&
      log.endpoint === "/ready"
    ) {
      ready.resolve(date.getTime());
    }
    onLog(log, date.getTime());
  });

  const services = Layer.mergeAll(
    Layer.succeed(Options, options),
    Layer.succeed(Metrics, new MetricsService()),
    Logger.layer([
      createLogger({ level: options.logLevel, mode: options.logFormat }),
      logger,
    ]),
    // Note: The logs of interest are at `info`. The logger of Ponder drops
    // logs under its level.
    Layer.succeed(
      References.MinimumLogLevel,
      options.logLevel === "debug"
        ? "Debug"
        : options.logLevel === "trace"
          ? "Trace"
          : "Info",
    ),
  );

  const fiber = Effect.runFork(
    Effect.scoped(startApp({ cliOptions: fullOptions })).pipe(
      Effect.provide(services),
    ),
  );
  const exited = new Promise<number>((resolve) =>
    fiber.addObserver((exit) => resolve(Exit.isSuccess(exit) ? exit.value : 1)),
  );
  exited.then((code) =>
    ready.reject(new Error(`Ponder exited with code ${code}`)),
  );

  return {
    ready: ready.promise,
    exited,
    /** Stop Ponder, like its shutdown sequence. */
    stop: () => Effect.runPromise(Fiber.interrupt(fiber)),
  };
};

/** Read the plan in `file`. */
export const readPlan = (file: string) =>
  JSON.parse(readFileSync(file, "utf8")) as Plan;

/**
 * Serve the chains of the plan in `planFile` in a child process, so that it
 * doesn't use the CPU of Ponder, and wait until it is up.
 */
export const startChainServer = async (planFile: string, port: number) => {
  const child = Bun.spawn(
    [
      "bun",
      "run",
      path.join(import.meta.dirname, "chain-server.ts"),
      planFile,
      String(port),
    ],
    { stdout: "inherit", stderr: "inherit" },
  );

  const stats = async (): Promise<Stats> =>
    (await fetch(`http://localhost:${port}/stats`)).json() as Promise<Stats>;

  while (true) {
    if (child.exitCode !== null) {
      throw new Error(`Chain server exited with code ${child.exitCode}`);
    }
    try {
      await stats();
      break;
    } catch {
      await Bun.sleep(50);
    }
  }

  return { stats, stop: () => child.kill() };
};

/** Drop and create the database `name`. */
export const resetDatabase = async (serverUrl: string, name: string) => {
  const admin = new pg.Client({
    connectionString: `${serverUrl}/${process.env.PGDATABASE ?? "postgres"}`,
  });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.query(`CREATE DATABASE "${name}"`);
  await admin.end();
};
