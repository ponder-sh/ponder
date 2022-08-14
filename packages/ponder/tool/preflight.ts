import { mkdir } from "node:fs/promises";

import { toolConfig } from "./config";

const { pathToPonderDir, pathToBuildDir, pathToGeneratedDir } = toolConfig;

const ensureDirectoriesExist = async () => {
  await Promise.all([
    mkdir(pathToPonderDir, { recursive: true }),
    mkdir(pathToBuildDir, { recursive: true }),
    mkdir(pathToGeneratedDir, { recursive: true }),
  ]);
};

export { ensureDirectoriesExist };
