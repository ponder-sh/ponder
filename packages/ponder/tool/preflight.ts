import { mkdir } from "node:fs/promises";
import prettier from "prettier";

import { toolConfig } from "./config";

const { pathToPonderDir, pathToBuildDir, pathToGeneratedDir } = toolConfig;

const ensureDirectoriesExist = async () => {
  await Promise.all([
    mkdir(pathToPonderDir, { recursive: true }),
    mkdir(pathToBuildDir, { recursive: true }),
    mkdir(pathToGeneratedDir, { recursive: true }),
  ]);
};

let prettierConfig: prettier.Options = { parser: "typescript" };

const readPrettierConfig = async () => {
  if (prettierConfig) return prettierConfig;

  const configFilePath = await prettier.resolveConfigFile();
  if (configFilePath) {
    const foundConfig = await prettier.resolveConfig(configFilePath);
    if (foundConfig) {
      console.log(`Found prettier config at: ${configFilePath}`);
      prettierConfig = foundConfig;
    }
  }

  return prettierConfig;
};

const formatPrettier = (
  source: string,
  configOverrides?: Partial<prettier.Options>
) => {
  return prettier.format(source, { ...prettierConfig, ...configOverrides });
};

export { ensureDirectoriesExist, formatPrettier, readPrettierConfig };
