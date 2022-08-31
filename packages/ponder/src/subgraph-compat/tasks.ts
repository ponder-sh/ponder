import type { GraphQLSchema } from "graphql";

import type { DbSchema } from "../db";
import { buildDbSchema } from "../db";
import { buildGqlSchema } from "../graphql";
import { startServer } from "../startServer";
import type { GraphHandlers } from "./buildHandlers";
import { buildHandlers } from "./buildHandlers";
import { getRpcUrlMap } from "./getRpcUrlMap";
import { readSubgraphSchema } from "./readSubgraphSchema";
import type { GraphCompatPonderConfig } from "./readSubgraphYaml";
import { readSubgraphYaml } from "./readSubgraphYaml";
import { handleReindex } from "./reindex";

const state: {
  config?: GraphCompatPonderConfig;
  userSchema?: GraphQLSchema;
  gqlSchema?: GraphQLSchema;
  dbSchema?: DbSchema;
  handlers?: GraphHandlers;
  isIndexingInProgress?: boolean;
} = {};

enum TaskName {
  UPDATE_SUBGRAPH_YAML,
  UPDATE_SUBGRAPH_SCHEMA,
  BUILD_GQL_SCHEMA,
  BUILD_DB_SCHEMA,
  BUILD_HANDLERS,
  START_SERVER,
  REINDEX,
}

type Task = {
  name: TaskName;
  handler: () => Promise<void>;
  dependencies?: TaskName[];
};

const updateSubgraphYamlTask: Task = {
  name: TaskName.UPDATE_SUBGRAPH_YAML,
  handler: async () => {
    const rpcUrlMap = getRpcUrlMap();
    state.config = await readSubgraphYaml(rpcUrlMap);
  },
  dependencies: [
    TaskName.UPDATE_SUBGRAPH_SCHEMA,
    TaskName.START_SERVER,
    TaskName.BUILD_HANDLERS,
    TaskName.REINDEX,
  ],
};

const updateSubgraphSchemaTask: Task = {
  name: TaskName.UPDATE_SUBGRAPH_SCHEMA,
  handler: async () => {
    if (state.config) {
      state.userSchema = await readSubgraphSchema(
        state.config?.graphSchemaFilePath
      );
    }
  },
  dependencies: [TaskName.BUILD_GQL_SCHEMA, TaskName.BUILD_DB_SCHEMA],
};

const buildGqlSchemaTask: Task = {
  name: TaskName.BUILD_GQL_SCHEMA,
  handler: async () => {
    if (state.userSchema) {
      state.gqlSchema = buildGqlSchema(state.userSchema);
    }
  },
  dependencies: [TaskName.START_SERVER],
};

const startServerTask: Task = {
  name: TaskName.START_SERVER,
  handler: async () => {
    if (state.config && state.gqlSchema) {
      startServer(state.config, state.gqlSchema);
    }
  },
};

const buildDbSchemaTask: Task = {
  name: TaskName.BUILD_DB_SCHEMA,
  handler: async () => {
    if (state.userSchema) {
      state.dbSchema = buildDbSchema(state.userSchema);
    }
  },
  dependencies: [TaskName.REINDEX],
};

const buildHandlersTask: Task = {
  name: TaskName.BUILD_HANDLERS,
  handler: async () => {
    if (state.config) {
      state.handlers = await buildHandlers(state.config);
    }
  },
  dependencies: [TaskName.REINDEX],
};

const reindexTask: Task = {
  name: TaskName.REINDEX,
  handler: async () => {
    if (!state.dbSchema || !state.config || !state.handlers) {
      return;
    }

    // TODO: Use actual DB transactions to handle this. That way, can stop
    // in-flight indexing job by rolling back txn and then start new.
    if (state.isIndexingInProgress) return;

    state.isIndexingInProgress = true;
    await handleReindex(state.config, state.dbSchema, state.handlers);
    state.isIndexingInProgress = false;
  },
};

const taskMap: Record<TaskName, Task> = {
  [TaskName.UPDATE_SUBGRAPH_YAML]: updateSubgraphYamlTask,
  [TaskName.UPDATE_SUBGRAPH_SCHEMA]: updateSubgraphSchemaTask,
  [TaskName.BUILD_GQL_SCHEMA]: buildGqlSchemaTask,
  [TaskName.BUILD_DB_SCHEMA]: buildDbSchemaTask,
  [TaskName.BUILD_HANDLERS]: buildHandlersTask,
  [TaskName.START_SERVER]: startServerTask,
  [TaskName.REINDEX]: reindexTask,
};

const runTask = async (task: Task) => {
  await task.handler();

  const depTasks = (task.dependencies || []).map((name) => taskMap[name]);
  depTasks.forEach(runTask);
};

export {
  buildHandlersTask,
  runTask,
  updateSubgraphSchemaTask,
  updateSubgraphYamlTask,
};
