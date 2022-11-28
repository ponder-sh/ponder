import path from "node:path";

import { PonderCliOptions } from "@/bin/ponder";

export type PonderOptions = {
  PONDER_CONFIG_FILE_PATH: string;
  SCHEMA_FILE_PATH: string;
  HANDLERS_DIR_PATH: string;
  GENERATED_DIR_PATH: string;
  PONDER_DIR_PATH: string;
};

export const buildOptions = (options: PonderCliOptions): PonderOptions => {
  const PONDER_CONFIG_FILE_PATH = options.configFile || "ponder.config.js";

  const dir = process.cwd();
  const abs = (targetPath: string) => path.join(dir, targetPath);

  const defaults = {
    // File path options
    PONDER_CONFIG_FILE_PATH: PONDER_CONFIG_FILE_PATH,
    SCHEMA_FILE_PATH: "schema.graphql",
    HANDLERS_DIR_PATH: "handlers",
    GENERATED_DIR_PATH: "generated",
    PONDER_DIR_PATH: ".ponder",
  };

  return {
    ...defaults,
    // Resolve absolute paths
    PONDER_CONFIG_FILE_PATH: abs(defaults.PONDER_CONFIG_FILE_PATH),
    SCHEMA_FILE_PATH: abs(defaults.SCHEMA_FILE_PATH),
    HANDLERS_DIR_PATH: abs(defaults.HANDLERS_DIR_PATH),
    GENERATED_DIR_PATH: abs(defaults.GENERATED_DIR_PATH),
    PONDER_DIR_PATH: abs(defaults.PONDER_DIR_PATH),
  };
};
