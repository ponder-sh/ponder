import debounce from "froebel/debounce";
import { GraphQLSchema } from "graphql";
import type { WatchListener } from "node:fs";
import { watch } from "node:fs";

import type { DbSchema } from "./buildDbSchema";
import { buildDbSchema } from "./buildDbSchema";
import { buildGqlSchema } from "./buildGqlSchema";
import { buildHandlerContext, HandlerContext } from "./buildHandlerContext";
import {
  hydrateCache,
  testUserConfigChanged,
  testUserHandlersChanged,
  testUserSchemaChanged,
} from "./cache";
import { toolConfig } from "./config";
import { fetchAndProcessLogs } from "./logs/processLogs";
import { migrateDb } from "./migrateDb";
import { ensureDirectoriesExist } from "./preflight";
import type { PonderConfig } from "./readUserConfig";
import { readUserConfig } from "./readUserConfig";
import { readUserHandlers, UserHandlers } from "./readUserHandlers";
import { readUserSchema } from "./readUserSchema";
import { restartServer } from "./server";
import {
  generateContractTypes,
  generateEntityTypes,
  generateHandlerTypes,
  generateSchema,
} from "./typegen";
import { generateContextType } from "./typegen/generateContextType";

const { pathToUserHandlersFile, pathToUserConfigFile, pathToUserSchemaFile } =
  toolConfig;

type PonderState = {
  config?: PonderConfig;
  userSchema?: GraphQLSchema;
  gqlSchema?: GraphQLSchema;
  dbSchema?: DbSchema;
  handlerContext?: HandlerContext;
  userHandlers?: UserHandlers;
  // entityNames?: string[] ?????? maybe for caching handlerContext better
};

const state: PonderState = {};

const handleUserHandlersFileChanged = async () => {
  const userHandlers = await readUserHandlers();
  handleUserHandlersChanged(userHandlers);
};

const handleUserConfigFileChanged = async () => {
  const config = await readUserConfig();
  handleConfigChanged(config);
};

const handleUserSchemaFileChanged = async () => {
  const userSchema = await readUserSchema();
  handleUserSchemaChanged(userSchema);
};

const handleUserHandlersChanged = async (newUserHandlers: UserHandlers) => {
  // const oldUserHandlers = state.userHandlers;
  state.userHandlers = newUserHandlers;

  if (state.config && state.handlerContext) {
    fetchAndProcessLogs(state.config, newUserHandlers, state.handlerContext);
  }
};

const handleConfigChanged = async (newConfig: PonderConfig) => {
  // const oldConfig = state.config;
  state.config = newConfig;

  generateContractTypes(newConfig);
  generateHandlerTypes(newConfig);

  // TODO: Uncomment when de-duplicating is better.
  // if (state.userHandlers && state.handlerContext) {
  //   fetchAndProcessLogs(newConfig, state.userHandlers, state.handlerContext);
  // }

  if (state.dbSchema) {
    generateContextType(newConfig, state.dbSchema);

    const handlerContext = buildHandlerContext(newConfig, state.dbSchema);
    handleHandlerContextChanged(handlerContext);
  }
};

const handleUserSchemaChanged = async (newUserSchema: GraphQLSchema) => {
  // const oldUserSchema = state.userSchema;
  state.userSchema = newUserSchema;

  const gqlSchema = buildGqlSchema(newUserSchema);
  handleGqlSchemaChanged(gqlSchema);

  const dbSchema = buildDbSchema(newUserSchema);
  handleDbSchemaChanged(dbSchema);
};

const handleGqlSchemaChanged = async (newGqlSchema: GraphQLSchema) => {
  // const oldGqlSchema = state.gqlSchema;
  state.gqlSchema = newGqlSchema;

  generateSchema(newGqlSchema);
  generateEntityTypes(newGqlSchema);

  restartServer(newGqlSchema);

  state.gqlSchema = newGqlSchema;
};

const handleDbSchemaChanged = async (newDbSchema: DbSchema) => {
  // const oldDbSchema = state.dbSchema;
  state.dbSchema = newDbSchema;

  migrateDb(newDbSchema);

  if (state.config) {
    generateContextType(state.config, newDbSchema);

    const handlerContext = buildHandlerContext(state.config, newDbSchema);
    handleHandlerContextChanged(handlerContext);
  }
};

const handleHandlerContextChanged = async (
  newHandlerContext: HandlerContext
) => {
  // const oldHandlerContext = state.handlerContext;
  state.handlerContext = newHandlerContext;

  // TODO: Uncomment when de-duplicating is better.
  // if (state.config && state.userHandlers) {
  //   fetchAndProcessLogs(state.config, state.userHandlers, newHandlerContext);
  // }
};

const dev = async () => {
  await Promise.all([hydrateCache(), ensureDirectoriesExist()]);

  // NOTE: Might be possible to be more smart about this,
  // but I'm pretty sure these all need to be kicked off here.
  handleUserHandlersFileChanged();
  handleUserConfigFileChanged();
  handleUserSchemaFileChanged();

  const userHandlersListener = debounce<WatchListener<string>>(
    async (event, fileName) => {
      const isChanged = await testUserHandlersChanged();
      if (isChanged) {
        console.log(`Detected ${event} in handlers/${fileName}`);
        handleUserHandlersFileChanged();
      }
    },
    300
  );

  const userConfigListener = debounce<WatchListener<string>>(
    async (event, fileName) => {
      const isChanged = await testUserConfigChanged();
      if (isChanged) {
        console.log(`Detected ${event} in ${fileName}`);
        handleUserConfigFileChanged();
      }
    },
    300
  );

  const schemaListener = debounce<WatchListener<string>>(
    async (event, fileName) => {
      const isChanged = await testUserSchemaChanged();
      if (isChanged) {
        console.log(`Detected ${event} in ${fileName}`);
        handleUserSchemaFileChanged();
      }
    },
    300
  );

  watch(pathToUserHandlersFile, userHandlersListener);
  watch(pathToUserConfigFile, userConfigListener);
  watch(pathToUserSchemaFile, schemaListener);
};

dev().catch(console.error);
