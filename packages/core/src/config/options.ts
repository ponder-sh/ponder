import path from "node:path";

import { PonderCliOptions } from "@/bin/ponder";

import { ResolvedPonderConfig } from "./ponderConfig";

export type PonderOptions = {
  configFile: string;
  schemaFile: string;
  rootDir: string;
  srcDir: string;
  generatedDir: string;
  ponderDir: string;

  port: number;
  maxHealthcheckDuration: number;

  logLevel: number;
  uiEnabled: boolean;
};

export const buildOptions = ({
  cliOptions,
  configOptions = {},
}: {
  cliOptions: PonderCliOptions;
  configOptions?: ResolvedPonderConfig["options"];
}): PonderOptions => {
  const defaults = {
    rootDir: path.resolve(cliOptions.rootDir),
    configFile: cliOptions.configFile,
    schemaFile: "schema.graphql",
    srcDir: "src",
    generatedDir: "generated",
    ponderDir: ".ponder",

    port: Number(process.env.PORT ?? 42069),
    maxHealthcheckDuration: configOptions?.maxHealthcheckDuration ?? 240,

    logLevel: Number(process.env.PONDER_LOG_LEVEL ?? 2),
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
  };
};
