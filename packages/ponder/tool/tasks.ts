import type { GraphQLSchema } from "graphql";

import type { DbSchema } from "./buildDbSchema";
import { buildDbSchema } from "./buildDbSchema";
import { buildGqlSchema } from "./buildGqlSchema";
import type { PonderConfig } from "./readUserConfig";
import { readUserConfig } from "./readUserConfig";
import { readUserHandlers, UserHandlers } from "./readUserHandlers";
import { readUserSchema } from "./readUserSchema";
import { handleReindex } from "./reindex";
import { restartServer } from "./server";
import {
  generateContractTypes,
  generateEntityTypes,
  generateHandlerTypes,
  generateSchema,
} from "./typegen";
import { generateContextType } from "./typegen/generateContextType";

const state: {
  config?: PonderConfig;
  userSchema?: GraphQLSchema;
  gqlSchema?: GraphQLSchema;
  dbSchema?: DbSchema;
  userHandlers?: UserHandlers;
  isIndexingInProgress?: boolean;
} = {};

enum TaskName {
  UPDATE_USER_HANDLERS,
  UPDATE_USER_CONFIG,
  UPDATE_USER_SCHEMA,
  REINDEX,
  GENERATE_CONTRACT_TYPES,
  GENERATE_HANDLER_TYPES,
  GENERATE_CONTEXT_TYPE,
  BUILD_GQL_SCHEMA,
  BUILD_DB_SCHEMA,
  GENERATE_GQL_SCHEMA,
  GENERATE_ENTITY_TYPES,
  START_SERVER,
}

type Task = {
  name: TaskName;
  handler: () => Promise<void>;
  dependencies?: TaskName[];
};

const updateUserHandlersTask: Task = {
  name: TaskName.UPDATE_USER_HANDLERS,
  handler: async () => {
    state.userHandlers = await readUserHandlers();
  },
  dependencies: [TaskName.REINDEX],
};

const updateUserConfigTask: Task = {
  name: TaskName.UPDATE_USER_CONFIG,
  handler: async () => {
    state.config = await readUserConfig();
  },
  dependencies: [
    TaskName.GENERATE_CONTRACT_TYPES,
    TaskName.GENERATE_HANDLER_TYPES,
    TaskName.REINDEX,
    TaskName.GENERATE_CONTEXT_TYPE,
  ],
};

const updateUserSchemaTask: Task = {
  name: TaskName.UPDATE_USER_SCHEMA,
  handler: async () => {
    state.userSchema = await readUserSchema();
  },
  dependencies: [TaskName.BUILD_GQL_SCHEMA, TaskName.BUILD_DB_SCHEMA],
};

const reindexTask: Task = {
  name: TaskName.REINDEX,
  handler: async () => {
    if (!state.dbSchema || !state.config || !state.userHandlers) {
      return;
    }

    // TODO: Use actual DB transactions to handle this. That way, can stop
    // in-flight indexing job by rolling back txn and then start new.
    if (state.isIndexingInProgress) return;

    state.isIndexingInProgress = true;
    await handleReindex(state.config, state.dbSchema, state.userHandlers);
    state.isIndexingInProgress = false;
  },
};

const buildGqlSchemaTask: Task = {
  name: TaskName.BUILD_GQL_SCHEMA,
  handler: async () => {
    if (state.userSchema) {
      state.gqlSchema = buildGqlSchema(state.userSchema);
    }
  },
  dependencies: [
    TaskName.GENERATE_GQL_SCHEMA,
    TaskName.GENERATE_ENTITY_TYPES,
    TaskName.START_SERVER,
  ],
};

const buildDbSchemaTask: Task = {
  name: TaskName.BUILD_DB_SCHEMA,
  handler: async () => {
    if (state.userSchema) {
      state.dbSchema = buildDbSchema(state.userSchema);
    }
  },
  dependencies: [TaskName.GENERATE_CONTEXT_TYPE, TaskName.REINDEX],
};

const generateContractTypesTask: Task = {
  name: TaskName.GENERATE_CONTRACT_TYPES,
  handler: async () => {
    if (state.config) {
      generateContractTypes(state.config);
    }
  },
};

const generateHandlerTypesTask: Task = {
  name: TaskName.GENERATE_HANDLER_TYPES,
  handler: async () => {
    if (state.config) {
      generateHandlerTypes(state.config);
    }
  },
};

const generateContextTypeTask: Task = {
  name: TaskName.GENERATE_CONTEXT_TYPE,
  handler: async () => {
    if (state.config && state.dbSchema) {
      generateContextType(state.config, state.dbSchema);
    }
  },
};

const generateGqlSchemaTask: Task = {
  name: TaskName.GENERATE_GQL_SCHEMA,
  handler: async () => {
    if (state.gqlSchema) {
      generateSchema(state.gqlSchema);
    }
  },
};

const generateEntityTypesTask: Task = {
  name: TaskName.GENERATE_ENTITY_TYPES,
  handler: async () => {
    if (state.gqlSchema) {
      generateEntityTypes(state.gqlSchema);
    }
  },
};

const startServerTask: Task = {
  name: TaskName.START_SERVER,
  handler: async () => {
    if (state.gqlSchema) {
      restartServer(state.gqlSchema);
    }
  },
};

const taskMap: Record<TaskName, Task> = {
  [TaskName.UPDATE_USER_HANDLERS]: updateUserHandlersTask,
  [TaskName.UPDATE_USER_CONFIG]: updateUserConfigTask,
  [TaskName.UPDATE_USER_SCHEMA]: updateUserSchemaTask,
  [TaskName.REINDEX]: reindexTask,
  [TaskName.GENERATE_CONTRACT_TYPES]: generateContractTypesTask,
  [TaskName.GENERATE_HANDLER_TYPES]: generateHandlerTypesTask,
  [TaskName.GENERATE_CONTEXT_TYPE]: generateContextTypeTask,
  [TaskName.BUILD_GQL_SCHEMA]: buildGqlSchemaTask,
  [TaskName.BUILD_DB_SCHEMA]: buildDbSchemaTask,
  [TaskName.GENERATE_GQL_SCHEMA]: generateGqlSchemaTask,
  [TaskName.GENERATE_ENTITY_TYPES]: generateEntityTypesTask,
  [TaskName.START_SERVER]: startServerTask,
};

const runTask = async (task: Task) => {
  await task.handler();

  const depTasks = (task.dependencies || []).map((name) => taskMap[name]);
  depTasks.forEach(runTask);
};

export {
  runTask,
  updateUserConfigTask,
  updateUserHandlersTask,
  updateUserSchemaTask,
};
