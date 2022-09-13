import { ensureDirectoriesExist, readPrettierConfig } from "@/common/utils";

import {
  readHandlersTask,
  readPonderConfigTask,
  readSchemaTask,
  runTask,
} from "../core/tasks";

const start = async () => {
  ensureDirectoriesExist();
  await readPrettierConfig();

  runTask(readPonderConfigTask);
  runTask(readSchemaTask);
  runTask(readHandlersTask);
};

export { start };
