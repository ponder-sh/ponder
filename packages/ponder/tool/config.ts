import path from "node:path";

// This could be provided as CLI params?
const toolConfigRaw = {
  pathToUserConfigFile: "ponder.config.js",
  pathToUserSchemaFile: "schema.graphql",
  pathToGeneratedDir: "generated",
  pathToPonderDir: ".ponder",
};

const dir = process.cwd();

const toolConfig = {
  pathToUserConfigFile: path.join(dir, toolConfigRaw.pathToUserConfigFile),
  pathToUserSchemaFile: path.join(dir, toolConfigRaw.pathToUserSchemaFile),
  pathToGeneratedDir: path.join(dir, toolConfigRaw.pathToGeneratedDir),
  pathToPonderDir: path.join(dir, toolConfigRaw.pathToPonderDir),
};

export { toolConfig };
