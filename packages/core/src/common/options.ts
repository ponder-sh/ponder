import path from "node:path";
import type { CliOptions } from "@/bin/ponder.js";
import type { LevelWithSilent } from "pino";

export type Options = {
  configFile: string;
  schemaFile: string;
  rootDir: string;
  srcDir: string;
  generatedDir: string;
  ponderDir: string;
  logDir: string;

  port: number;
  hostname?: string;
  maxHealthcheckDuration: number;

  telemetryUrl: string;
  telemetryDisabled: boolean;
  telemetryConfigDir: string | undefined;

  logLevel: LevelWithSilent;
};

export const buildOptions = ({ cliOptions }: { cliOptions: CliOptions }) => {
  let rootDir: string;
  if (cliOptions.root !== undefined) {
    rootDir = path.resolve(cliOptions.root);
  } else {
    rootDir = path.resolve(".");
  }

  let logLevel: LevelWithSilent;
  if (cliOptions.trace === true) {
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

  let maxHealthcheckDuration: number;
  if (process.env.RAILWAY_HEALTHCHECK_TIMEOUT_SEC) {
    const railwayTimeout = Number(process.env.RAILWAY_HEALTHCHECK_TIMEOUT_SEC);
    maxHealthcheckDuration = Math.max(railwayTimeout - 5, 0);
  } else {
    maxHealthcheckDuration = 240;
  }

  return {
    rootDir,
    configFile: path.join(rootDir, cliOptions.config),
    schemaFile: path.join(rootDir, "ponder.schema.ts"),
    srcDir: path.join(rootDir, "src"),
    generatedDir: path.join(rootDir, "generated"),
    ponderDir: path.join(rootDir, ".ponder"),
    logDir: path.join(rootDir, ".ponder", "logs"),

    port,
    hostname,
    maxHealthcheckDuration,

    telemetryUrl: "http://localhost:3000/api/telemetry",
    telemetryDisabled: Boolean(process.env.PONDER_TELEMETRY_DISABLED),
    telemetryConfigDir: undefined,

    logLevel,
  } satisfies Options;
};
