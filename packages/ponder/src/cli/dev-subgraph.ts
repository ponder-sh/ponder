import type { WatchListener } from "node:fs";
import { watch } from "node:fs";
import path from "node:path";

import { CONFIG } from "../config";
import {
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
  // runTask(updateUserHandlersTask);
  runTask(updateSubgraphYamlTask);
  runTask(updateSubgraphSchemaTask);

  // const runUpdateUserHandlersTask = createWatchListener(
  //   async (fileName: string) => {
  //     logger.info(`\x1b[33m${`DETECTED CHANGE IN: ${fileName}`}\x1b[0m`); // yellow
  //     runTask(updateUserHandlersTask);
  //   },
  //   CONFIG.HANDLERS_DIR_PATH
  // );

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

  // watch(CONFIG.HANDLERS_DIR_PATH, runUpdateUserHandlersTask);
  watch(CONFIG.GRAPH_COMPAT_SUBGRAPH_YAML_PATH, runUpdateSubgraphYamlTask);
  watch(CONFIG.GRAPH_COMPAT_SUBGRAPH_SCHEMA_PATH, runUpdateSubgraphSchemaTask);
};

export { dev };
