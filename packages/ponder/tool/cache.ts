import { createHash } from "crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { toolConfig } from "./config";

const {
  pathToUserConfigFile,
  pathToUserSchemaFile,
  pathToPonderDir,
  pathToUserHandlersFile,
} = toolConfig;

const generateHash = (content: Buffer | string) => {
  let hash = createHash("md5");
  hash = hash.update(content);
  return hash.digest("hex");
};

type PonderCache = {
  userHandlers?: string;
  userConfig?: string;
  userSchema?: string;
};

// eslint-disable-next-line prefer-const
let cache: PonderCache = {};

const hydrateCache = async () => {
  const foundCache = await readCache();
  cache = foundCache;
};

const readCache = async () => {
  try {
    const rawCache = await readFile(
      path.join(pathToPonderDir, "cache.json"),
      "utf-8"
    );
    // TODO: Validate cache read from file.
    const cache: PonderCache = rawCache ? JSON.parse(rawCache) : {};
    return cache;
  } catch (e) {
    return {};
  }
};

const writeCache = async () => {
  await writeFile(
    path.join(pathToPonderDir, "cache.json"),
    JSON.stringify(cache),
    "utf-8"
  );
};

const testUserHandlersChanged = async () => {
  const contents = await readFile(pathToUserHandlersFile, "utf-8");
  const hash = generateHash(contents);

  const isChanged = hash !== cache.userHandlers;
  if (isChanged) {
    cache.userHandlers = hash;
    writeCache();
  }

  return isChanged;
};

const testUserConfigChanged = async () => {
  const contents = await readFile(pathToUserConfigFile, "utf-8");
  const hash = generateHash(contents);

  const isChanged = hash !== cache.userConfig;
  if (isChanged) {
    cache.userConfig = hash;
    writeCache();
  }

  return isChanged;
};

const testUserSchemaChanged = async () => {
  const contents = await readFile(pathToUserSchemaFile, "utf-8");
  const hash = generateHash(contents);

  const isChanged = hash !== cache.userSchema;
  if (isChanged) {
    cache.userSchema = hash;
    writeCache();
  }

  return isChanged;
};

export {
  cache,
  hydrateCache,
  testUserConfigChanged,
  testUserHandlersChanged,
  testUserSchemaChanged,
};
