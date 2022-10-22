import type { WatchListener } from "node:fs";
import { watch } from "node:fs";
import path from "node:path";

import { logger } from "@/common/logger";
import { OPTIONS } from "@/common/options";
import { isFileChanged } from "@/common/utils";

// import {
//   readHandlersTask,
//   readPonderConfigTask,
//   readSchemaTask,
//   runTask,
// } from "../core/tasks";

// This function is fully broken because it passes only the file name, not the path,
// to isFileChanged, which then uses fileReadSync using only the file name, which will
// break if the file is not in the repository root.
const createWatchListener = (
  fn: (fileName: string) => Promise<void>,
  pathPrefix?: string
): WatchListener<string> => {
  return async (_, fileName) => {
    const filePath = pathPrefix ? path.join(pathPrefix, fileName) : fileName;
    if (isFileChanged(filePath)) {
      fn(fileName);
    }
  };
};

const dev = async () => {
  // // TODO: Make the dev server response to handler file changes again
  // /// by rearranging the task dependency graph.
  // runTask(readHandlersTask);
  // runTask(readPonderConfigTask);
  // runTask(readSchemaTask);
  // const runUpdateUserHandlersTask = createWatchListener(
  //   async (fileName: string) => {
  //     logger.info("");
  //     logger.info(`\x1b[35m${`Detected change in: ${fileName}`}\x1b[0m`); // yellow
  //     runTask(readHandlersTask);
  //   },
  //   OPTIONS.HANDLERS_DIR_PATH
  // );
  // const runUpdateUserConfigTask = createWatchListener(async () => {
  //   logger.info("");
  //   logger.info(
  //     `\x1b[35m${`Detected change in: ${path.basename(
  //       OPTIONS.PONDER_CONFIG_FILE_PATH
  //     )}`}\x1b[0m`
  //   ); // yellow
  //   runTask(readPonderConfigTask);
  // });
  // const runUpdateUserSchemaTask = createWatchListener(async () => {
  //   logger.info("");
  //   logger.info(
  //     `\x1b[35m${`Detected change in: ${path.basename(
  //       OPTIONS.SCHEMA_FILE_PATH
  //     )}`}\x1b[0m`
  //   ); // yellow
  //   runTask(readSchemaTask);
  // });
  // watch(OPTIONS.HANDLERS_DIR_PATH, runUpdateUserHandlersTask);
  // watch(OPTIONS.PONDER_CONFIG_FILE_PATH, runUpdateUserConfigTask);
  // watch(OPTIONS.SCHEMA_FILE_PATH, runUpdateUserSchemaTask);
};

export { dev };
