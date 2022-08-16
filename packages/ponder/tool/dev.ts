import { debounce } from "froebel";
import type { WatchListener } from "node:fs";
import { watch } from "node:fs";

import { CONFIG } from "./config";
import { fileIsChanged } from "./helpers";
import { logger } from "./logger";
import { ensureDirectoriesExist, readPrettierConfig } from "./preflight";
import {
  runTask,
  updateUserConfigTask,
  updateUserHandlersTask,
  updateUserSchemaTask,
} from "./tasks";

const { userHandlersDir, userConfigFile, userSchemaFile } = CONFIG;

const createWatchListener = (
  fn: (fileName: string) => Promise<void>,
  time = 20
): WatchListener<string> => {
  const debounced = debounce(fn, time);

  return async (_, fileName) => {
    const isChanged = await fileIsChanged(fileName);
    if (isChanged) {
      debounced(fileName);
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
    },
    50
  );

  const runUpdateUserConfigTask = createWatchListener(async () => {
    logger.info(`\x1b[33m${`DETECTED CHANGE IN: ponder.config.js`}\x1b[0m`); // yellow
    runTask(updateUserConfigTask);
  }, 50);

  const runUpdateUserSchemaTask = createWatchListener(async () => {
    logger.info(`\x1b[33m${`DETECTED CHANGE IN: ponder.config.js`}\x1b[0m`); // yellow
    runTask(updateUserSchemaTask);
  }, 50);

  watch(userHandlersDir, runUpdateUserHandlersTask);
  watch(userConfigFile, runUpdateUserConfigTask);
  watch(userSchemaFile, runUpdateUserSchemaTask);
};

export { dev };
