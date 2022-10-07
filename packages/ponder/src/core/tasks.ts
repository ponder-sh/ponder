import type { GraphQLSchema } from "graphql";

import type { GraphqlApi } from "@/apis/graphql";
import { buildGqlSchema } from "@/apis/graphql/buildGqlSchema";
import { generateContextTypes } from "@/codegen/generateContextTypes";
import { generateHandlerTypes } from "@/codegen/generateHandlerTypes";
import { generateSchema } from "@/codegen/generateSchema";
import { generateSchemaTypes } from "@/codegen/generateSchemaTypes";
import { logger } from "@/common/logger";
import { handleReindex } from "@/core/indexer/reindex";
import { buildPonderSchema } from "@/core/schema/buildPonderSchema";
import type { EvmSource } from "@/sources/evm";
import type { CacheStore } from "@/stores/baseCacheStore";
import type { EntityStore } from "@/stores/baseEntityStore";

import type { Handlers } from "./readHandlers";
import { readHandlers } from "./readHandlers";
import {
  buildEvmSources,
  buildGraphqlApi,
  buildSqliteStores,
  readPonderConfig,
} from "./readPonderConfig";
import { readSchema } from "./readSchema";
import type { PonderSchema } from "./schema/types";

const state: {
  sources?: EvmSource[];
  api?: GraphqlApi;
  cacheStore?: CacheStore;
  entityStore?: EntityStore;

  userSchema?: GraphQLSchema;
  schema?: PonderSchema;

  gqlSchema?: GraphQLSchema;
  handlers?: Handlers;

  isIndexingInProgress?: boolean;
  isSchemaTypeFileGenerated?: boolean;
} = {};

enum TaskName {
  READ_PONDER_CONFIG,
  READ_SCHEMA,
  READ_HANDLERS,
  BUILD_GQL_SCHEMA,
  BUILD_PONDER_SCHEMA,
  GENERATE_HANDLER_TYPES,
  GENERATE_CONTEXT_TYPES,
  GENERATE_GQL_SCHEMA,
  GENERATE_SCHEMA_TYPES,
  START_APIS,
  REINDEX,
}

type Task = {
  name: TaskName;
  handler: () => Promise<void>;
  dependencies?: TaskName[];
};

export const runTask = async (task: Task) => {
  await task.handler();

  const depTasks = (task.dependencies || []).map((name) => taskMap[name]);
  depTasks.forEach(runTask);
};

export const readPonderConfigTask: Task = {
  name: TaskName.READ_PONDER_CONFIG,
  handler: async () => {
    const config = readPonderConfig();

    const { sources } = buildEvmSources(config);
    state.sources = sources;

    if (!state.entityStore || !state.cacheStore) {
      const { entityStore, cacheStore } = buildSqliteStores(config);
      state.entityStore = entityStore;
      state.cacheStore = cacheStore;
    }

    // This currently won't hot reload if the server port changes.
    if (!state.api) {
      state.api = buildGraphqlApi(config, state.entityStore);
    }
  },
  dependencies: [
    TaskName.GENERATE_HANDLER_TYPES,
    TaskName.GENERATE_CONTEXT_TYPES,
    TaskName.REINDEX,
    TaskName.START_APIS,
  ],
};

export const readSchemaTask: Task = {
  name: TaskName.READ_SCHEMA,
  handler: async () => {
    state.userSchema = readSchema();
  },
  dependencies: [TaskName.BUILD_PONDER_SCHEMA],
};

export const readHandlersTask: Task = {
  name: TaskName.READ_HANDLERS,
  handler: async () => {
    // NOTE: After adding enum support, could no longer import
    // the user handlers module before the entity types are generated
    // because esbuild cannot strip enum imports (they are values).
    // So, sadly this task depends on GENERATE_SCHEMA_TYPES via this boolean.
    if (state.isSchemaTypeFileGenerated) {
      state.handlers = await readHandlers();
    }
  },
  dependencies: [TaskName.REINDEX],
};

const buildPonderSchemaTask: Task = {
  name: TaskName.BUILD_PONDER_SCHEMA,
  handler: async () => {
    if (state.userSchema) {
      state.schema = buildPonderSchema(state.userSchema);
    }
  },
  dependencies: [
    TaskName.REINDEX,
    TaskName.BUILD_GQL_SCHEMA,
    TaskName.GENERATE_CONTEXT_TYPES,
  ],
};

const buildGqlSchemaTask: Task = {
  name: TaskName.BUILD_GQL_SCHEMA,
  handler: async () => {
    if (state.schema) {
      state.gqlSchema = buildGqlSchema(state.schema);
    }
  },
  dependencies: [
    TaskName.GENERATE_GQL_SCHEMA,
    TaskName.GENERATE_SCHEMA_TYPES,
    TaskName.START_APIS,
  ],
};

const generateSchemaTypesTask: Task = {
  name: TaskName.GENERATE_SCHEMA_TYPES,
  handler: async () => {
    if (state.gqlSchema) {
      await generateSchemaTypes(state.gqlSchema);
      state.isSchemaTypeFileGenerated = true;
    }
  },
  dependencies: [TaskName.READ_HANDLERS],
};

const generateHandlerTypesTask: Task = {
  name: TaskName.GENERATE_HANDLER_TYPES,
  handler: async () => {
    if (state.sources) {
      await generateHandlerTypes(state.sources);
    }
  },
};

const generateContextTypesTask: Task = {
  name: TaskName.GENERATE_CONTEXT_TYPES,
  handler: async () => {
    if (state.sources && state.schema) {
      await generateContextTypes(state.sources, state.schema);
    }
  },
};

const generateGqlSchemaTask: Task = {
  name: TaskName.GENERATE_GQL_SCHEMA,
  handler: async () => {
    if (state.gqlSchema) {
      await generateSchema(state.gqlSchema);
    }
  },
};

const reindexTask: Task = {
  name: TaskName.REINDEX,
  handler: async () => {
    if (
      !state.cacheStore ||
      !state.entityStore ||
      state.sources === undefined ||
      !state.schema ||
      !state.handlers
    ) {
      logger.debug("Skipped indexing, dependencies not ready");
      return;
    }

    // TODO: Use actual DB transactions to handle this. That way, can stop
    // in-flight indexing job by rolling back txn and then start new.
    if (state.isIndexingInProgress) return;

    state.isIndexingInProgress = true;
    await handleReindex(
      state.cacheStore,
      state.entityStore,
      state.sources,
      state.schema,
      state.handlers
    );
    state.isIndexingInProgress = false;
  },
};

const startApisTask: Task = {
  name: TaskName.START_APIS,
  handler: async () => {
    if (state.api && state.gqlSchema) {
      state.api.start(state.gqlSchema);
    }
  },
};

const taskMap: Record<TaskName, Task> = {
  [TaskName.READ_PONDER_CONFIG]: readPonderConfigTask,
  [TaskName.READ_HANDLERS]: readHandlersTask,
  [TaskName.READ_SCHEMA]: readSchemaTask,
  [TaskName.BUILD_GQL_SCHEMA]: buildGqlSchemaTask,
  [TaskName.BUILD_PONDER_SCHEMA]: buildPonderSchemaTask,
  [TaskName.GENERATE_HANDLER_TYPES]: generateHandlerTypesTask,
  [TaskName.GENERATE_CONTEXT_TYPES]: generateContextTypesTask,
  [TaskName.GENERATE_GQL_SCHEMA]: generateGqlSchemaTask,
  [TaskName.GENERATE_SCHEMA_TYPES]: generateSchemaTypesTask,
  [TaskName.REINDEX]: reindexTask,
  [TaskName.START_APIS]: startApisTask,
};
