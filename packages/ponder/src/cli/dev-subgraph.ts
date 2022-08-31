import type { WatchListener } from "node:fs";
import { watch } from "node:fs";
import path from "node:path";

import { CONFIG } from "../config";
import {
  buildHandlersTask,
  runTask,
  updateSubgraphSchemaTask,
  updateSubgraphYamlTask,
} from "../subgraph-compat/tasks";
import { fileIsChanged } from "../utils/helpers";
import { logger } from "../utils/logger";
import { ensureDirectoriesExist, readPrettierConfig } from "../utils/preflight";

const createWatchListener = (
  fn: (fileName: string) => Promise<void>,
  pathPrefix?: string
): WatchListener<string> => {
  return async (_, fileName) => {
    const filePath = pathPrefix ? path.join(pathPrefix, fileName) : fileName;
    const isChanged = await fileIsChanged(filePath);
    if (isChanged) {
      fn(fileName);
    }
  };
};

const dev = async () => {
  await Promise.all([ensureDirectoriesExist(), readPrettierConfig()]);

  // TODO: Make the dev server response to handler file changes again
  /// by rearranging the task dependency graph.
  runTask(updateSubgraphYamlTask);
  runTask(updateSubgraphSchemaTask);

  const runUpdateSubgraphYamlTask = createWatchListener(async () => {
    logger.info(
      `\x1b[33m${`DETECTED CHANGE IN: ${path.basename(
        CONFIG.GRAPH_COMPAT_SUBGRAPH_YAML_PATH
      )}`}\x1b[0m`
    ); // yellow
    runTask(updateSubgraphYamlTask);
  });

  const runUpdateSubgraphSchemaTask = createWatchListener(async () => {
    logger.info(
      `\x1b[33m${`DETECTED CHANGE IN: ${path.basename(
        CONFIG.GRAPH_COMPAT_SUBGRAPH_SCHEMA_PATH
      )}`}\x1b[0m`
    ); // yellow
    runTask(updateSubgraphSchemaTask);
  });

  const runBuildHandlersTask = createWatchListener(async (fileName: string) => {
    logger.info(`\x1b[33m${`DETECTED CHANGE IN: ${fileName}`}\x1b[0m`); // yellow
    runTask(buildHandlersTask);
  }, CONFIG.GRAPH_COMPAT_HANDLERS_DIR_PATH);

  watch(CONFIG.GRAPH_COMPAT_SUBGRAPH_YAML_PATH, runUpdateSubgraphYamlTask);
  watch(CONFIG.GRAPH_COMPAT_SUBGRAPH_SCHEMA_PATH, runUpdateSubgraphSchemaTask);
  watch(CONFIG.GRAPH_COMPAT_HANDLERS_DIR_PATH, runBuildHandlersTask);
};

export { dev };
