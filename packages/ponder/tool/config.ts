import path from "node:path";

const toolConfigRaw = {
  userHandlersFile: "handlers/index.ts",
  userConfigFile: "ponder.config.js",
  userSchemaFile: "schema.graphql",
  generatedDir: "generated",
  handlersDir: "handlers",
  buildDir: ".ponder/build",
  ponderDir: ".ponder",
};

const dir = process.cwd();

const toolConfig = {
  userHandlersFile: path.join(dir, toolConfigRaw.userHandlersFile),
  userConfigFile: path.join(dir, toolConfigRaw.userConfigFile),
  userSchemaFile: path.join(dir, toolConfigRaw.userSchemaFile),
  generatedDir: path.join(dir, toolConfigRaw.generatedDir),
  handlersDir: path.join(dir, toolConfigRaw.handlersDir),
  buildDir: path.join(dir, toolConfigRaw.buildDir),
  ponderDir: path.join(dir, toolConfigRaw.ponderDir),
};

export { toolConfig };
