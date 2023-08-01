import path from "node:path";
import type { LevelWithSilent } from "pino";

import type { CliOptions } from "@/bin/ponder";

import type { ResolvedConfig } from "./config";

export type Options = {
  configFile: string;
  schemaFile: string;
  rootDir: string;
  srcDir: string;
  generatedDir: string;
  ponderDir: string;
  logDir: string;

  port: number;
  maxHealthcheckDuration: number;
  telemetryDisabled: boolean;

  logLevel: LevelWithSilent;
  uiEnabled: boolean;
};

export const buildOptions = ({
  cliOptions,
  configOptions = {},
}: {
  cliOptions: CliOptions;
  configOptions?: ResolvedConfig["options"];
}): Options => {
  const railwayHealthcheckTimeout = process.env.RAILWAY_HEALTHCHECK_TIMEOUT_SEC
    ? Math.max(Number(process.env.RAILWAY_HEALTHCHECK_TIMEOUT_SEC) - 5, 0) // Add 5 seconds of buffer.
    : undefined;

  const logLevel = (
    process.env.PONDER_LOG_LEVEL &&
    ["silent", "fatal", "error", "warn", "info", "debug", "trace"].includes(
      process.env.PONDER_LOG_LEVEL
    )
      ? process.env.PONDER_LOG_LEVEL
      : "info"
  ) as LevelWithSilent;

  const defaults = {
    rootDir: path.resolve(cliOptions.rootDir),
    configFile: cliOptions.configFile,
    schemaFile: "schema.graphql",
    srcDir: "src",
    generatedDir: "generated",
    ponderDir: ".ponder",
    logDir: ".ponder/logs",
    telemetryDisabled: Boolean(process.env.PONDER_TELEMETRY_DISABLED),
    port: Number(process.env.PORT ?? 42069),
    maxHealthcheckDuration:
      configOptions?.maxHealthcheckDuration ?? railwayHealthcheckTimeout ?? 240,

    logLevel,
    uiEnabled: true,
  };

  return {
    ...defaults,
    // Resolve paths
    configFile: path.join(defaults.rootDir, defaults.configFile),
    schemaFile: path.join(defaults.rootDir, defaults.schemaFile),
    srcDir: path.join(defaults.rootDir, defaults.srcDir),
    generatedDir: path.join(defaults.rootDir, defaults.generatedDir),
    ponderDir: path.join(defaults.rootDir, defaults.ponderDir),
    logDir: path.join(defaults.rootDir, defaults.logDir),
  };
};
