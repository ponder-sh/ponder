import path from "node:path";
import v8 from "node:v8";
import type { CliOptions } from "@/bin/ponder.js";
import type { LevelWithSilent } from "pino";

export type Options = {
  command: "dev" | "start" | "serve" | "codegen";

  configFile: string;
  schemaFile: string;
  rootDir: string;
  indexingDir: string;
  apiDir: string;
  generatedDir: string;
  ponderDir: string;
  logDir: string;

  port: number;
  hostname?: string;

  telemetryUrl: string;
  telemetryDisabled: boolean;
  telemetryConfigDir: string | undefined;

  logLevel: LevelWithSilent;
  logFormat: "json" | "pretty";

  databaseHeartbeatInterval: number;
  databaseHeartbeatTimeout: number;
  databaseMaxQueryParameters: number;

  factoryAddressCountThreshold: number;

  indexingCacheMaxBytes: number;
  indexingCacheFlushRatio: number;

  syncStoreMaxIntervals: number;
  syncEventsQuerySize: number;
  syncHandoffStaleSeconds: number;
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

    rootDir,
    configFile: path.join(rootDir, cliOptions.config),
    schemaFile: path.join(rootDir, "ponder.schema.ts"),
    indexingDir: path.join(rootDir, "src"),
    apiDir: path.join(rootDir, "src", "api"),
    generatedDir: path.join(rootDir, "generated"),
    ponderDir: path.join(rootDir, ".ponder"),
    logDir: path.join(rootDir, ".ponder", "logs"),

    port,
    hostname,

    telemetryUrl: "https://ponder.sh/api/telemetry",
    telemetryDisabled: Boolean(process.env.PONDER_TELEMETRY_DISABLED),
    telemetryConfigDir: undefined,

    logLevel,
    logFormat: cliOptions.logFormat! as Options["logFormat"],

    databaseHeartbeatInterval: 10 * 1000,
    databaseHeartbeatTimeout: 25 * 1000,
    // Half of the max query parameters for PGlite
    databaseMaxQueryParameters: 16_000,

    factoryAddressCountThreshold: 1_000,

    // v8.getHeapStatistics().heap_size_limit / 8, bucketed closest to 128, 256, 512, 1024, 2048 mB
    indexingCacheMaxBytes:
      2 **
        Math.min(
          Math.max(
            Math.round(
              Math.log2(
                v8.getHeapStatistics().heap_size_limit / 1_024 / 1_024 / 8,
              ),
            ),
            7,
          ),
          11,
        ) *
      1_024 *
      1_024,
    indexingCacheFlushRatio: 0.35,

    syncStoreMaxIntervals: 5_000,
    syncEventsQuerySize: 10_000,
    syncHandoffStaleSeconds: 300,
  } satisfies Options;
};
