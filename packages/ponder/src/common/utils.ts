import { createHash } from "crypto";
import { mkdirSync, readFileSync } from "fs";
import prettier from "prettier";

import { CONFIG } from "@/common/config";
import { logger } from "@/common/logger";

export const groupBy = <T>(array: T[], fn: (item: T) => string | number) => {
  return array.reduce<{ [k: string | number]: T[] }>((acc, item) => {
    const key = fn(item);
    (acc[key] = acc[key] || []).push(item);
    return acc;
  }, {});
};

export const startBenchmark = () => process.hrtime();
export const endBenchmark = (hrt: [number, number]) => {
  const diffHrt = process.hrtime(hrt);
  const diffMilliseconds = Math.round(diffHrt[0] * 1000 + diffHrt[1] / 1000000);
  const diffString =
    diffMilliseconds >= 1000
      ? `${Math.round((diffMilliseconds / 1000) * 10) / 10}s`
      : `${diffMilliseconds}ms`;

  return diffString;
};

const latestFileHash: { [key: string]: string | undefined } = {};

export const fileIsChanged = (filePath: string) => {
  // TODO: I think this throws if the file being watched gets deleted while
  // the development server is running. Should handle this case gracefully.
  const content = readFileSync(filePath, "utf-8");
  const hash = createHash("md5").update(content).digest("hex");

  const prevHash = latestFileHash[filePath];
  latestFileHash[filePath] = hash;
  if (!prevHash) {
    // If there is no previous hash, this file is being changed for the first time.
    return true;
  } else {
    // If there is a previous hash, check if the content hash has changed.
    return prevHash !== hash;
  }
};

export const ensureDirectoriesExist = () => {
  mkdirSync(CONFIG.PONDER_DIR_PATH, { recursive: true });
  mkdirSync(CONFIG.GENERATED_DIR_PATH, { recursive: true });
};

let prettierConfig: prettier.Options = { parser: "typescript" };

export const readPrettierConfig = async () => {
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

export const formatPrettier = (
  source: string,
  configOverrides?: Partial<prettier.Options>
) => {
  return prettier.format(source, { ...prettierConfig, ...configOverrides });
};
