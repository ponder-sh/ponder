import path from "node:path";

// This could be provided as CLI params?
const toolConfigRaw = {
  pathToUserConfigFile: "ponder.config.js",
  pathToSchemaFile: "schema.graphql",
  pathToGeneratedDir: "generated",
};

const dir = process.cwd();

const toolConfig = {
  pathToUserConfigFile: path.join(dir, toolConfigRaw.pathToUserConfigFile),
  pathToSchemaFile: path.join(dir, toolConfigRaw.pathToSchemaFile),
  pathToGeneratedDir: path.join(dir, toolConfigRaw.pathToGeneratedDir),
};

export { toolConfig };
