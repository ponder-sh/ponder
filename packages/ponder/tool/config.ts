// This could be provided as CLI params?
const toolConfigRaw = {
  pathToUserConfigFile: "ponder.config.js",
  pathToSchemaFile: "schema.gql",
  pathToGeneratedDir: "generated",
};

const pwd = process.cwd();

const toolConfig = {
  pathToUserConfigFile: `${pwd}/${toolConfigRaw.pathToUserConfigFile}`,
  pathToSchemaFile: `${pwd}/${toolConfigRaw.pathToSchemaFile}`,
  pathToGeneratedDir: `${pwd}/${toolConfigRaw.pathToGeneratedDir}`,
};

export { toolConfig };
