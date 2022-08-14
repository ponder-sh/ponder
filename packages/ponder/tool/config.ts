import path from "node:path";

// This could be provided as CLI params?
const toolConfigRaw = {
  pathToUserHandlersFile: "handlers/index.ts",
  pathToUserConfigFile: "ponder.config.js",
  pathToUserSchemaFile: "schema.graphql",
  pathToGeneratedDir: "generated",
  pathToHandlersDir: "handlers",
  pathToBuildDir: "build",
  pathToPonderDir: ".ponder",
};

const dir = process.cwd();

const toolConfig = {
  pathToUserHandlersFile: path.join(dir, toolConfigRaw.pathToUserHandlersFile),
  pathToUserConfigFile: path.join(dir, toolConfigRaw.pathToUserConfigFile),
  pathToUserSchemaFile: path.join(dir, toolConfigRaw.pathToUserSchemaFile),
  pathToGeneratedDir: path.join(dir, toolConfigRaw.pathToGeneratedDir),
  pathToHandlersDir: path.join(dir, toolConfigRaw.pathToHandlersDir),
  pathToBuildDir: path.join(dir, toolConfigRaw.pathToBuildDir),
  pathToPonderDir: path.join(dir, toolConfigRaw.pathToPonderDir),
};

export { toolConfig };
