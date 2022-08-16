import debounce from "froebel/debounce";
import type { GraphQLSchema } from "graphql";
import { watch } from "node:fs";

import type { DbSchema } from "./buildDbSchema";
import { buildDbSchema } from "./buildDbSchema";
import { buildGqlSchema } from "./buildGqlSchema";
import { buildHandlerContext, HandlerContext } from "./buildHandlerContext";
import { CONFIG } from "./config";
import { createOrUpdateDbTables } from "./db";
import { endBenchmark, startBenchmark } from "./helpers";
import { logger } from "./logger";
import { fetchAndProcessLogs } from "./logs";
import { ensureDirectoriesExist, readPrettierConfig } from "./preflight";
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

const { userHandlersDir, userConfigFile, userSchemaFile } = CONFIG;

type PonderState = {
  config?: PonderConfig;
  userSchema?: GraphQLSchema;
  gqlSchema?: GraphQLSchema;
  dbSchema?: DbSchema;
  handlerContext?: HandlerContext;
  userHandlers?: UserHandlers;
  isIndexingInProgress?: boolean;
};

const state: PonderState = {};

const handleUserHandlersFileChanged = debounce(async () => {
  const userHandlers = await readUserHandlers();
  handleUserHandlersChanged(userHandlers);
}, 200);

const handleUserConfigFileChanged = debounce(async () => {
  const config = await readUserConfig();
  handleConfigChanged(config);
}, 200);

const handleUserSchemaFileChanged = debounce(async () => {
  const userSchema = await readUserSchema();
  handleUserSchemaChanged(userSchema);
}, 200);

const handleUserHandlersChanged = async (newUserHandlers: UserHandlers) => {
  // const oldUserHandlers = state.userHandlers;
  state.userHandlers = newUserHandlers;

  handleReindex();
};

const handleConfigChanged = async (newConfig: PonderConfig) => {
  // const oldConfig = state.config;
  state.config = newConfig;

  generateContractTypes(newConfig);
  generateHandlerTypes(newConfig);

  handleReindex();

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

  handleReindex();
};

const handleReindex = async () => {
  // This will fire... basically on any user saved change.
  // TODO: Implement a simple mechanism to only commit the latest db
  // changes if they conflict (if the user saves two files very fast?)
  // Maybe need a generalized implementation of this,
  // could use for the file writers also.
  // Lol this is literally debouncing!

  if (
    !state.dbSchema ||
    !state.config ||
    !state.userHandlers ||
    !state.handlerContext
  ) {
    return;
  }

  // TODO: Use actual DB transactions to handle this. That way, can stop
  // in-flight indexing job by rolling back txn and then start new.
  if (state.isIndexingInProgress) {
    return;
  }

  state.isIndexingInProgress = true;
  const startHrt = startBenchmark();
  logger.info(`\x1b[33m${"REINDEXING..."}\x1b[0m`); // yellow

  await createOrUpdateDbTables(state.dbSchema);

  await fetchAndProcessLogs(
    state.config,
    state.userHandlers,
    state.handlerContext
  );

  state.isIndexingInProgress = false;
  const diff = endBenchmark(startHrt);

  logger.info(
    `\x1b[32m${`REINDEXING COMPLETE (${diff})`}\x1b[0m`, // green
    "\n"
  );
};

const dev = async () => {
  await Promise.all([ensureDirectoriesExist(), readPrettierConfig()]);

  handleUserHandlersFileChanged();
  handleUserConfigFileChanged();
  handleUserSchemaFileChanged();

  watch(userHandlersDir, handleUserHandlersFileChanged);
  watch(userConfigFile, handleUserConfigFileChanged);
  watch(userSchemaFile, handleUserSchemaFileChanged);
};

export { dev };
