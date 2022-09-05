import type { WatchListener } from "node:fs";
import { watch } from "node:fs";
import path from "node:path";

import { CONFIG } from "@/common/config";
import { logger } from "@/common/logger";
import {
  ensureDirectoriesExist,
  fileIsChanged,
  readPrettierConfig,
} from "@/common/utils";

import {
  readHandlersTask,
  readPonderConfigTask,
  readSchemaTask,
  runTask,
} from "../core/tasks";

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
  runTask(readHandlersTask);
  runTask(readPonderConfigTask);
  runTask(readSchemaTask);

  const runUpdateUserHandlersTask = createWatchListener(
    async (fileName: string) => {
      logger.info(`\x1b[33m${`DETECTED CHANGE IN: ${fileName}`}\x1b[0m`); // yellow
      runTask(readHandlersTask);
    },
    CONFIG.HANDLERS_DIR_PATH
  );

  const runUpdateUserConfigTask = createWatchListener(async () => {
    logger.info(
      `\x1b[33m${`DETECTED CHANGE IN: ${path.basename(
        CONFIG.PONDER_CONFIG_FILE_PATH
      )}`}\x1b[0m`
    ); // yellow
    runTask(readPonderConfigTask);
  });

  const runUpdateUserSchemaTask = createWatchListener(async () => {
    logger.info(
      `\x1b[33m${`DETECTED CHANGE IN: ${path.basename(
        CONFIG.SCHEMA_FILE_PATH
      )}`}\x1b[0m`
    ); // yellow
    runTask(readSchemaTask);
  });

  watch(CONFIG.HANDLERS_DIR_PATH, runUpdateUserHandlersTask);
  watch(CONFIG.PONDER_CONFIG_FILE_PATH, runUpdateUserConfigTask);
  watch(CONFIG.SCHEMA_FILE_PATH, runUpdateUserSchemaTask);
};

export { dev };
