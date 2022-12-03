import path from "node:path";

import { PonderCliOptions } from "@/bin/ponder";

export type PonderOptions = {
  PONDER_CONFIG_FILE_PATH: string;
  SCHEMA_FILE_PATH: string;
  HANDLERS_DIR_PATH: string;
  GENERATED_DIR_PATH: string;
  PONDER_DIR_PATH: string;

  SILENT: boolean;
};

export const buildOptions = (options: PonderCliOptions): PonderOptions => {
  const configFile = options.configFile;
  const rootDir = path.resolve(options.rootDir);
  const silent = options.silent;

  const defaults = {
    SILENT: silent,
    // File path options
    PONDER_CONFIG_FILE_PATH: configFile,
    SCHEMA_FILE_PATH: "schema.graphql",
    HANDLERS_DIR_PATH: "handlers",
    GENERATED_DIR_PATH: "generated",
    PONDER_DIR_PATH: ".ponder",
  };

  return {
    ...defaults,
    // Resolve paths
    PONDER_CONFIG_FILE_PATH: path.join(
      rootDir,
      defaults.PONDER_CONFIG_FILE_PATH
    ),
    SCHEMA_FILE_PATH: path.join(rootDir, defaults.SCHEMA_FILE_PATH),
    HANDLERS_DIR_PATH: path.join(rootDir, defaults.HANDLERS_DIR_PATH),
    GENERATED_DIR_PATH: path.join(rootDir, defaults.GENERATED_DIR_PATH),
    PONDER_DIR_PATH: path.join(rootDir, defaults.PONDER_DIR_PATH),
  };
};
