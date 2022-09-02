import type { GraphQLSchema } from "graphql";

import {
  generateContextTypes,
  generateContractTypes,
  generateHandlerTypes,
  generateSchema,
  generateSchemaTypes,
} from "@/codegen";
import { buildSchema } from "@/db";
import { buildGqlSchema, readSchema } from "@/gql";
import { handleReindex } from "@/indexer";
import type { PonderConfig, Schema } from "@/types";

import { readUserConfig } from "./readUserConfig";
import { readUserHandlers, UserHandlers } from "./readUserHandlers";
import { startServer } from "./startServer";

const state: {
  config?: PonderConfig;
  userSchema?: GraphQLSchema;
  gqlSchema?: GraphQLSchema;
  schema?: Schema;
  userHandlers?: UserHandlers;
  isIndexingInProgress?: boolean;
} = {};

enum TaskName {
  READ_HANDLERS,
  READ_CONFIG,
  READ_SCHEMA,
  BUILD_GQL_SCHEMA,
  BUILD_SCHEMA,
  GENERATE_CONTRACT_TYPES,
  GENERATE_HANDLER_TYPES,
  GENERATE_CONTEXT_TYPES,
  GENERATE_GQL_SCHEMA,
  GENERATE_SCHEMA_TYPES,
  START_SERVER,
  REINDEX,
}

type Task = {
  name: TaskName;
  handler: () => Promise<void>;
  dependencies?: TaskName[];
};

const updateUserHandlersTask: Task = {
  name: TaskName.READ_HANDLERS,
  handler: async () => {
    state.userHandlers = await readUserHandlers();
  },
  dependencies: [TaskName.REINDEX],
};

const updateUserConfigTask: Task = {
  name: TaskName.READ_CONFIG,
  handler: async () => {
    state.config = await readUserConfig();
  },
  dependencies: [
    TaskName.GENERATE_CONTRACT_TYPES,
    TaskName.GENERATE_HANDLER_TYPES,
    TaskName.REINDEX,
    TaskName.GENERATE_CONTEXT_TYPES,
    TaskName.START_SERVER,
  ],
};

const updateUserSchemaTask: Task = {
  name: TaskName.READ_SCHEMA,
  handler: async () => {
    state.userSchema = await readSchema();
  },
  dependencies: [TaskName.BUILD_GQL_SCHEMA, TaskName.BUILD_SCHEMA],
};

const reindexTask: Task = {
  name: TaskName.REINDEX,
  handler: async () => {
    if (!state.schema || !state.config || !state.userHandlers) {
      return;
    }

    // TODO: Use actual DB transactions to handle this. That way, can stop
    // in-flight indexing job by rolling back txn and then start new.
    if (state.isIndexingInProgress) return;

    state.isIndexingInProgress = true;
    await handleReindex(state.config, state.schema, state.userHandlers);
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
    TaskName.GENERATE_SCHEMA_TYPES,
    TaskName.GENERATE_CONTRACT_TYPES,
    TaskName.START_SERVER,
  ],
};

const buildSchemaTask: Task = {
  name: TaskName.BUILD_SCHEMA,
  handler: async () => {
    if (state.userSchema) {
      state.schema = buildSchema(state.userSchema);
    }
  },
  dependencies: [TaskName.GENERATE_CONTEXT_TYPES, TaskName.REINDEX],
};

const generateContractTypesTask: Task = {
  name: TaskName.GENERATE_CONTRACT_TYPES,
  handler: async () => {
    if (state.config) {
      await generateContractTypes(state.config);
    }
  },
};

const generateHandlerTypesTask: Task = {
  name: TaskName.GENERATE_HANDLER_TYPES,
  handler: async () => {
    if (state.config) {
      await generateHandlerTypes(state.config);
    }
  },
};

const generateContextTypesTask: Task = {
  name: TaskName.GENERATE_CONTEXT_TYPES,
  handler: async () => {
    if (state.config && state.schema) {
      await generateContextTypes(state.config, state.schema);
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

const generateSchemaTypesTask: Task = {
  name: TaskName.GENERATE_SCHEMA_TYPES,
  handler: async () => {
    if (state.gqlSchema) {
      await generateSchemaTypes(state.gqlSchema);
    }
  },
  // NOTE: After adding enum support, could no longer import
  // the user handlers module before the entity types are generated
  // because esbuild cannot strip enum imports (they are values).
  // TODO: Find a better / more reasonable dependency path here.
  dependencies: [TaskName.READ_HANDLERS],
};

const startServerTask: Task = {
  name: TaskName.START_SERVER,
  handler: async () => {
    if (state.config && state.gqlSchema) {
      startServer(state.config, state.gqlSchema);
    }
  },
};

const taskMap: Record<TaskName, Task> = {
  [TaskName.READ_HANDLERS]: updateUserHandlersTask,
  [TaskName.READ_CONFIG]: updateUserConfigTask,
  [TaskName.READ_SCHEMA]: updateUserSchemaTask,
  [TaskName.REINDEX]: reindexTask,
  [TaskName.GENERATE_CONTRACT_TYPES]: generateContractTypesTask,
  [TaskName.GENERATE_HANDLER_TYPES]: generateHandlerTypesTask,
  [TaskName.GENERATE_CONTEXT_TYPES]: generateContextTypesTask,
  [TaskName.BUILD_GQL_SCHEMA]: buildGqlSchemaTask,
  [TaskName.BUILD_SCHEMA]: buildSchemaTask,
  [TaskName.GENERATE_GQL_SCHEMA]: generateGqlSchemaTask,
  [TaskName.GENERATE_SCHEMA_TYPES]: generateSchemaTypesTask,
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
