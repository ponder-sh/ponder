import type { WatchListener } from "node:fs";
import { watch } from "node:fs";

import { CONFIG } from "./config";
import {
  runTask,
  updateUserConfigTask,
  updateUserHandlersTask,
  updateUserSchemaTask,
} from "./tasks";
import { fileIsChanged } from "./utils/helpers";
import { logger } from "./utils/logger";
import { ensureDirectoriesExist, readPrettierConfig } from "./utils/preflight";

const { userHandlersDir, userConfigFile, userSchemaFile } = CONFIG;

const createWatchListener = (
  fn: (fileName: string) => Promise<void>
): WatchListener<string> => {
  return async (_, fileName) => {
    const isChanged = await fileIsChanged(fileName);
    if (isChanged) {
      fn(fileName);
    }
  };
};

const dev = async () => {
  await Promise.all([ensureDirectoriesExist(), readPrettierConfig()]);

  runTask(updateUserHandlersTask);
  runTask(updateUserConfigTask);
  runTask(updateUserSchemaTask);

  const runUpdateUserHandlersTask = createWatchListener(
    async (fileName: string) => {
      logger.info(`\x1b[33m${`DETECTED CHANGE IN: ${fileName}`}\x1b[0m`); // yellow
      runTask(updateUserHandlersTask);
    }
  );

  const runUpdateUserConfigTask = createWatchListener(async () => {
    logger.info(`\x1b[33m${`DETECTED CHANGE IN: ponder.config.js`}\x1b[0m`); // yellow
    runTask(updateUserConfigTask);
  });

  const runUpdateUserSchemaTask = createWatchListener(async () => {
    logger.info(`\x1b[33m${`DETECTED CHANGE IN: ponder.config.js`}\x1b[0m`); // yellow
    runTask(updateUserSchemaTask);
  });

  watch(userHandlersDir, runUpdateUserHandlersTask);
  watch(userConfigFile, runUpdateUserConfigTask);
  watch(userSchemaFile, runUpdateUserSchemaTask);
};

export { dev };
