import path from "node:path";

import type { LevelWithSilent } from "pino";

import type { CliOptions } from "@/bin/ponder.js";

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
  telemetryIsExampleProject: boolean;

  logLevel: LevelWithSilent;
  uiEnabled: boolean;
};

export const buildOptions = ({
  cliOptions,
}: {
  cliOptions: CliOptions;
}): Options => {
  let rootDir: string;
  if (cliOptions.root !== undefined) {
    rootDir = path.resolve(cliOptions.root);
  } else {
    rootDir = path.resolve(".");
  }

  let logLevel: LevelWithSilent;
  if (cliOptions.trace) {
    logLevel = "trace";
  } else if (cliOptions.v !== undefined) {
    if (Array.isArray(cliOptions.v)) {
      logLevel = "trace";
    } else {
      logLevel = "debug";
    }
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

  let port: number;
  if (cliOptions.port !== undefined) {
    port = Number(cliOptions.port);
  } else if (process.env.PORT !== undefined) {
    port = Number(process.env.PORT);
  } else {
    port = 42069;
  }

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

    telemetryUrl: "https://ponder.sh/api/telemetry",
    telemetryDisabled: Boolean(process.env.PONDER_TELEMETRY_DISABLED),
    telemetryIsExampleProject: Boolean(
      process.env.PONDER_TELEMETRY_IS_EXAMPLE_PROJECT,
    ),

    logLevel,
    uiEnabled: true,
  };
};
