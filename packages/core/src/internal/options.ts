import path from "node:path";
import v8 from "node:v8";
import type { LevelWithSilent } from "pino";
import { parse, type SemVer } from "semver";

/**
 * The command-line inputs `buildOptions` reads.
 *
 * Declared here rather than imported from the CLI so that `Options` -- which
 * most of the codebase depends on -- does not pull in `bin/ponder.ts`, a
 * module whose last statement parses `process.argv` and runs a command. The
 * CLI's own commander-derived option type is checked against this one, so the
 * two cannot drift.
 */
export type CliOptions = {
  command: Options["command"];
  version: string;
  config: string;
  root?: string;
  schema?: string;
  viewsSchema?: string;
  port?: number;
  hostname?: string;
  logLevel?: string;
  logFormat?: string;
  debug?: boolean;
  trace?: boolean;
  disableUi?: boolean;
};

export type Options = {
  command: "dev" | "start" | "serve" | "codegen" | "list" | "prune";
  version: SemVer | null;
  configFile: string;
  schemaFile: string;
  apiDir: string;
  apiFile: string;
  rootDir: string;
  indexingDir: string;
  generatedDir: string;
  ponderDir: string;
  logDir: string;

  port: number;
  hostname?: string;

  logLevel: LevelWithSilent;
  logFormat: "json" | "pretty";

  databaseHeartbeatInterval: number;
  databaseHeartbeatTimeout: number;
  databaseMaxQueryParameters: number;

  maxThreads: number;

  factoryAddressCountThreshold: number;

  indexingCacheMaxBytes: number;

  rpcMaxConcurrency: number;

  syncEventsQuerySize: number;
};

export const buildOptions = ({ cliOptions }: { cliOptions: CliOptions }) => {
  let rootDir: string;
  if (cliOptions.root !== undefined) {
    rootDir = path.resolve(cliOptions.root);
  } else {
    rootDir = path.resolve(".");
  }

  let logLevel: LevelWithSilent;
  if (cliOptions.logLevel) {
    logLevel = cliOptions.logLevel as LevelWithSilent;
  } else if (cliOptions.trace === true) {
    logLevel = "trace";
  } else if (cliOptions.debug === true) {
    logLevel = "debug";
  } else if (
    process.env.PONDER_LOG_LEVEL !== undefined &&
    ["silent", "fatal", "error", "warn", "info", "debug", "trace"].includes(
      process.env.PONDER_LOG_LEVEL,
    )
  ) {
    logLevel = process.env.PONDER_LOG_LEVEL as LevelWithSilent;
  } else {
    logLevel = "info";
  }

  const port =
    process.env.PORT !== undefined
      ? Number(process.env.PORT)
      : cliOptions.port !== undefined
        ? cliOptions.port
        : 42069;

  const hostname = cliOptions.hostname;

  return {
    command: cliOptions.command,
    version: parse(cliOptions.version),
    rootDir,
    configFile: path.join(rootDir, cliOptions.config),
    schemaFile: path.join(rootDir, "ponder.schema.ts"),
    apiDir: path.join(rootDir, "src", "api"),
    apiFile: path.join(rootDir, "src", "api", "index.ts"),
    indexingDir: path.join(rootDir, "src"),
    generatedDir: path.join(rootDir, "generated"),
    ponderDir: path.join(rootDir, ".ponder"),
    logDir: path.join(rootDir, ".ponder", "logs"),

    port,
    hostname,

    logLevel,
    logFormat: cliOptions.logFormat! as Options["logFormat"],

    databaseHeartbeatInterval: 10 * 1000,
    databaseHeartbeatTimeout: 25 * 1000,
    // Half of the max query parameters for PGlite
    databaseMaxQueryParameters: 16_000,

    maxThreads:
      process.env.PONDER_MAX_THREADS !== undefined
        ? Number(process.env.PONDER_MAX_THREADS)
        : 4,

    factoryAddressCountThreshold: 1_000,

    rpcMaxConcurrency: 256,

    // v8.getHeapStatistics().heap_size_limit / 5, rounded up to the nearest 64 MB
    indexingCacheMaxBytes:
      process.env.PONDER_CACHE_BYTES !== undefined
        ? Number(process.env.PONDER_CACHE_BYTES)
        : Math.ceil(
            v8.getHeapStatistics().heap_size_limit / 1_024 / 1_024 / 5 / 64,
          ) *
          64 *
          1_024 *
          1_024,

    syncEventsQuerySize: 12_000,
  } satisfies Options;
};
