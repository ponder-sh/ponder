import path from "node:path";
import type { CliOptions } from "@/bin/ponder.js";
import type { LevelWithSilent } from "pino";
import { type SemVer, parse } from "semver";

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

  telemetryUrl: string;
  telemetryDisabled: boolean;
  telemetryConfigDir: string | undefined;

  logLevel: LevelWithSilent;
  logFormat: "json" | "pretty";

  databaseHeartbeatInterval: number;
  databaseHeartbeatTimeout: number;
  databaseMaxQueryParameters: number;

  factoryAddressCountThreshold: number;

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

    rpcMaxConcurrency: 256,

    syncEventsQuerySize: 15_000,
  } satisfies Options;
};
