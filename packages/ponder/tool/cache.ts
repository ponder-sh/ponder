import { createHash } from "crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "path";

import { toolConfig } from "./config";

const { pathToUserConfigFile, pathToUserSchemaFile, pathToPonderDir } =
  toolConfig;

const generateHash = (content: Buffer | string) => {
  let hash = createHash("md5");
  hash = hash.update(content);
  return hash.digest("hex");
};

type PonderCache = {
  userConfig?: string;
  userSchema?: string;
};

// eslint-disable-next-line prefer-const
let cache: PonderCache = {};

const handleHydrateCache = async () => {
  try {
    const rawCache = await readFile(
      path.join(pathToPonderDir, "cache.json"),
      "utf-8"
    );

    const foundCache: PonderCache = JSON.parse(rawCache);
    cache = foundCache;

    return cache;
  } catch (err) {
    return null;
  }
};

const handleWriteCache = async () => {
  await writeFile(
    path.join(pathToPonderDir, "cache.json"),
    JSON.stringify(cache),
    "utf-8"
  );
};

const testUserConfigChanged = async () => {
  const contents = await readFile(pathToUserConfigFile, "utf-8");
  const hash = generateHash(contents);

  if (hash !== cache.userConfig) {
    cache.userConfig = hash;
    handleWriteCache();
  }

  return hash !== cache.userConfig;
};

const testUserSchemaChanged = async () => {
  const contents = await readFile(pathToUserSchemaFile, "utf-8");
  const hash = generateHash(contents);

  if (hash !== cache.userSchema) {
    cache.userSchema = hash;
    handleWriteCache();
  }

  return hash !== cache.userSchema;
};

export {
  cache,
  handleHydrateCache,
  testUserConfigChanged,
  testUserSchemaChanged,
};
