import { ensureDirectoriesExist, readPrettierConfig } from "@/utils";

import {
  runTask,
  updateUserConfigTask,
  // updateUserHandlersTask,
  updateUserSchemaTask,
} from "../tasks";

const start = async () => {
  await Promise.all([ensureDirectoriesExist(), readPrettierConfig()]);

  // runTask(updateUserHandlersTask);
  runTask(updateUserConfigTask);
  runTask(updateUserSchemaTask);
};

export { start };
