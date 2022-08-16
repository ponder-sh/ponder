import path from "node:path";

const dir = process.cwd();

const CONFIG_RAW = {
  userHandlersFile: "handlers/index.ts",
  userConfigFile: "ponder.config.js",
  userSchemaFile: "schema.graphql",
  generatedDir: "generated",
  userHandlersDir: "handlers",
  buildDir: ".ponder/build",
  ponderDir: ".ponder",
  logLevel: 2, // LogLevel.Info
};

const CONFIG = {
  ...CONFIG_RAW,
  userHandlersFile: path.join(dir, CONFIG_RAW.userHandlersFile),
  userConfigFile: path.join(dir, CONFIG_RAW.userConfigFile),
  userSchemaFile: path.join(dir, CONFIG_RAW.userSchemaFile),
  generatedDir: path.join(dir, CONFIG_RAW.generatedDir),
  userHandlersDir: path.join(dir, CONFIG_RAW.userHandlersDir),
  buildDir: path.join(dir, CONFIG_RAW.buildDir),
  ponderDir: path.join(dir, CONFIG_RAW.ponderDir),
};

export { CONFIG };
