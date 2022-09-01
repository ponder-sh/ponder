import path from "node:path";

const dir = process.cwd();
const getAbsolutePath = (targetPath: string) => path.join(dir, targetPath);

// TODO: Parse these from CLI flags.
// const USER_OPTIONS = {};
const USER_OPTIONS = {
  GRAPH_COMPAT_ENABLED: true,
};

const DEFAULT_OPTIONS = {
  // File path options
  HANDLERS_DIR_PATH: "handlers",
  PONDER_CONFIG_FILE_PATH: "ponder.config.js",
  SCHEMA_FILE_PATH: "schema.graphql",
  GENERATED_DIR_PATH: "generated",
  PONDER_DIR_PATH: ".ponder",

  // General options
  LOG_LEVEL: 4,

  // Graph Protocol compatibility options
  GRAPH_COMPAT_ENABLED: false,
  GRAPH_COMPAT_SUBGRAPH_YAML_PATH: "subgraph.yaml",
  GRAPH_COMPAT_SUBGRAPH_SCHEMA_PATH: "schema.graphql",
  GRAPH_COMPAT_HANDLERS_DIR_PATH: "src",
};

const OPTIONS = {
  ...DEFAULT_OPTIONS,
  ...USER_OPTIONS,
};

const CONFIG = {
  ...OPTIONS,
  // Resolve absolute paths for _PATH options
  PONDER_CONFIG_FILE_PATH: getAbsolutePath(OPTIONS.PONDER_CONFIG_FILE_PATH),
  SCHEMA_FILE_PATH: getAbsolutePath(OPTIONS.SCHEMA_FILE_PATH),
  HANDLERS_DIR_PATH: getAbsolutePath(OPTIONS.HANDLERS_DIR_PATH),
  GENERATED_DIR_PATH: getAbsolutePath(OPTIONS.GENERATED_DIR_PATH),
  PONDER_DIR_PATH: getAbsolutePath(OPTIONS.PONDER_DIR_PATH),
  GRAPH_COMPAT_SUBGRAPH_YAML_PATH: getAbsolutePath(
    OPTIONS.GRAPH_COMPAT_SUBGRAPH_YAML_PATH
  ),
  GRAPH_COMPAT_SUBGRAPH_SCHEMA_PATH: getAbsolutePath(
    OPTIONS.GRAPH_COMPAT_SUBGRAPH_SCHEMA_PATH
  ),
  GRAPH_COMPAT_HANDLERS_DIR_PATH: getAbsolutePath(
    OPTIONS.GRAPH_COMPAT_HANDLERS_DIR_PATH
  ),
};

export { CONFIG };
