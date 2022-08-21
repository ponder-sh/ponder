import { mkdir } from "node:fs/promises";
import prettier from "prettier";

import { CONFIG } from "../config";
import { logger } from "./logger";

const ensureDirectoriesExist = async () => {
  await Promise.all([
    mkdir(CONFIG.PONDER_DIR_PATH, { recursive: true }),
    mkdir(CONFIG.GENERATED_DIR_PATH, { recursive: true }),
  ]);
};

let prettierConfig: prettier.Options = { parser: "typescript" };

const readPrettierConfig = async () => {
  if (prettierConfig) return prettierConfig;

  const configFilePath = await prettier.resolveConfigFile();
  if (configFilePath) {
    const foundConfig = await prettier.resolveConfig(configFilePath);
    if (foundConfig) {
      logger.info(`Found prettier config at: ${configFilePath}`);
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
