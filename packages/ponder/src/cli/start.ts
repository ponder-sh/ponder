import { ensureDirectoriesExist, readPrettierConfig } from "@/common/utils";

import {
  readHandlersTask,
  readPonderConfigTask,
  readSchemaTask,
  runTask,
} from "../core/tasks";

const start = async () => {
  await Promise.all([ensureDirectoriesExist(), readPrettierConfig()]);

  runTask(readPonderConfigTask);
  runTask(readSchemaTask);
  runTask(readHandlersTask);
};

export { start };
