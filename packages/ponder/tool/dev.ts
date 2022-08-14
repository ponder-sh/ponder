import { createHash } from "crypto";
import debounce from "froebel/debounce";
import { GraphQLSchema } from "graphql";
import type { WatchListener } from "node:fs";
import { watch } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "path";

import { buildHandlerContext, HandlerContext } from "./buildHandlerContext";
import { toolConfig } from "./config";
import type { DbSchema } from "./createDbSchema";
import { createDbSchema } from "./createDbSchema";
import { createGqlSchema } from "./createGqlSchema";
import { getInitialLogs } from "./fetchLogs";
import { generateContextType } from "./generateContextType";
import { generateContractTypes } from "./generateContractTypes";
import { generateEntityTypes } from "./generateEntityTypes";
import { generateHandlerTypes } from "./generateHandlerTypes";
import { generateSchema } from "./generateSchema";
import { getEntities } from "./helpers";
import { migrateDb } from "./migrateDb";
import { processLogs } from "./processLogs";
import type { PonderConfig, PonderUserConfig } from "./readUserConfig";
import { readUserConfig } from "./readUserConfig";
import { readUserSchema } from "./readUserSchema";
import { restartServer } from "./server";

// dependency graph:

// 	handlers
// 		processLogs (1 / 2)

// 	config.ponder.js
// 		generateContractTypes
// 		generateContextType (1 / 2)
// 		buildHandlerContext (1 / 2)
// 			processLogs (2 / 2)

// 	schema.graphql
// 		createGqlSchema
// 			generateSchema
// 			generateEntityTypes
// 			startServer
// 		createDbSchema
// 			migrateDb
// 			generateContextType (2 / 2)
// 			buildHandlerContext (2 / 2)

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

type PonderState = {
  userConfig?: PonderUserConfig;
  userSchema?: GraphQLSchema;
  config?: PonderConfig;
  gqlSchema?: GraphQLSchema;
  dbSchema?: DbSchema;
  handlerContext?: HandlerContext;
  // entityNames?: string[] ?????? maybe for caching handlerContext
};

let cache: PonderCache = {};
const state: PonderState = {};

const handleUserConfigFileChanged = async () => {
  const config = await readUserConfig();
  handleConfigChanged(config);
};

const handleUserSchemaFileChanged = async () => {
  const userSchema = await readUserSchema();
  handleUserSchemaChanged(userSchema);
};

const handleConfigChanged = async (newConfig: PonderConfig) => {
  const oldConfig = state.config;
  state.config = newConfig;

  generateContractTypes(newConfig);
  generateHandlerTypes(newConfig);

  if (state.dbSchema) {
    generateContextType(newConfig, state.dbSchema);

    const handlerContext = buildHandlerContext(newConfig, state.dbSchema);
    handleHandlerContextChanged(handlerContext);
  }
};

const handleUserSchemaChanged = async (newUserSchema: GraphQLSchema) => {
  const oldUserSchema = state.userSchema;
  state.userSchema = newUserSchema;

  const gqlSchema = createGqlSchema(newUserSchema);
  handleGqlSchemaChanged(gqlSchema);

  const dbSchema = createDbSchema(newUserSchema);
  handleDbSchemaChanged(dbSchema);
};

const handleGqlSchemaChanged = async (newGqlSchema: GraphQLSchema) => {
  const oldGqlSchema = state.gqlSchema;
  state.gqlSchema = newGqlSchema;

  generateSchema(newGqlSchema);
  generateEntityTypes(newGqlSchema);

  restartServer(newGqlSchema);

  state.gqlSchema = newGqlSchema;
};

const handleDbSchemaChanged = async (newDbSchema: DbSchema) => {
  const oldDbSchema = state.dbSchema;
  state.dbSchema = newDbSchema;

  // await migrateDb(newDbSchema);

  // if (state.config) {
  //   await generateContextType(state.config, newDbSchema);
  //   console.log(`Regenerated context type`);

  //   const handlerContext = buildHandlerContext(state.config, newDbSchema);
  //   handleHandlerContextChanged(handlerContext);
  // }
};

const handleHandlerContextChanged = async (
  newHandlerContext: HandlerContext
) => {
  const oldHandlerContext = state.handlerContext;
  state.handlerContext = newHandlerContext;

  // TODO: ...reindex the entire goddamn set of events?
  // TODO: ...re-register the handler functions and run them through the entire
  // set of events?
};

const handleReadCache = async () => {
  try {
    const rawCache = await readFile(
      path.join(pathToPonderDir, "cache.json"),
      "utf-8"
    );

    const cache: PonderCache = JSON.parse(rawCache);
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

const handleTestUserConfig = async () => {
  const contents = await readFile(pathToUserConfigFile, "utf-8");
  const hash = generateHash(contents);

  if (hash !== cache.userConfig) {
    cache.userConfig = hash;
    handleWriteCache();
  }

  return hash !== cache.userConfig;
};

const handleTestUserSchema = async () => {
  const contents = await readFile(pathToUserSchemaFile, "utf-8");
  const hash = generateHash(contents);

  if (hash !== cache.userSchema) {
    cache.userSchema = hash;
    handleWriteCache();
  }

  return hash !== cache.userSchema;
};

const dev = async () => {
  console.log("in dev");
  const foundCache = await handleReadCache();
  if (foundCache) {
    cache = foundCache;
  }

  handleUserConfigFileChanged();
  handleUserSchemaFileChanged();

  handleTestUserConfig();
  handleTestUserSchema();

  const userConfigListener = debounce<WatchListener<string>>(
    async (event, fileName) => {
      const isChanged = await handleTestUserConfig();
      if (isChanged) {
        console.log(`Detected ${event} in ${fileName}, reindexing...`);
        handleUserConfigFileChanged();
      }
    },
    300
  );

  const schemaListener = debounce<WatchListener<string>>(
    async (event, fileName) => {
      const isChanged = await handleTestUserSchema();
      if (isChanged) {
        console.log(`Detected ${event} in ${fileName}, reindexing...`);
        handleUserSchemaFileChanged();
      }
    },
    300
  );

  watch(pathToUserConfigFile, userConfigListener);
  watch(pathToUserSchemaFile, schemaListener);

  // const tableCount = await migrateDb(dbSchema);
  // console.log(`Created ${tableCount} tables`);

  // const initialLogsResult = await getInitialLogs(config);
  // console.log(`Fetched ${initialLogsResult.length} logs`);

  // const handlerContext = buildHandlerContext(config, dbSchema);

  // await processLogs(initialLogsResult, handlerContext);
};

dev().catch(console.error);
