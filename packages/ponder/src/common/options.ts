import path from "node:path";

const dir = process.cwd();
const getAbsolutePath = (targetPath: string) => path.join(dir, targetPath);

// TODO: Parse these from CLI flags.
const USER_OPTIONS = {};

const DEFAULT_OPTIONS = {
  // File path options
  PONDER_CONFIG_FILE_PATH: "ponder.config.js",
  SCHEMA_FILE_PATH: "schema.graphql",
  HANDLERS_DIR_PATH: "handlers",
  GENERATED_DIR_PATH: "generated",
  PONDER_DIR_PATH: ".ponder",

  // General options
  LOG_LEVEL:
    process.env.PONDER_LOG_LEVEL != undefined
      ? Number(process.env.PONDER_LOG_LEVEL)
      : 2,

  // GraphQL options
  GRAPHQL_SERVER_PORT: 42069,
};

const MERGED_OPTIONS = {
  ...DEFAULT_OPTIONS,
  ...USER_OPTIONS,
};

export const OPTIONS = {
  ...MERGED_OPTIONS,
  // Resolve absolute paths
  PONDER_CONFIG_FILE_PATH: getAbsolutePath(
    MERGED_OPTIONS.PONDER_CONFIG_FILE_PATH
  ),
  SCHEMA_FILE_PATH: getAbsolutePath(MERGED_OPTIONS.SCHEMA_FILE_PATH),
  HANDLERS_DIR_PATH: getAbsolutePath(MERGED_OPTIONS.HANDLERS_DIR_PATH),
  GENERATED_DIR_PATH: getAbsolutePath(MERGED_OPTIONS.GENERATED_DIR_PATH),
  PONDER_DIR_PATH: getAbsolutePath(MERGED_OPTIONS.PONDER_DIR_PATH),
};

export type PonderOptions = typeof OPTIONS;
