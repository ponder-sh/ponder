import { ensureDirectoriesExist, readPrettierConfig } from "@/common/utils";

import {
  readPonderConfigTask,
  readSchemaTask,
  runTask,
  // updateUserHandlersTask,
} from "../core/tasks";

const start = async () => {
  await Promise.all([ensureDirectoriesExist(), readPrettierConfig()]);

  runTask(readPonderConfigTask);
  runTask(readSchemaTask);
  // runTask(updateUserHandlersTask);
};

export { start };
