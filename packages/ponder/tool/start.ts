import {
  runTask,
  updateUserConfigTask,
  updateUserHandlersTask,
  updateUserSchemaTask,
} from "./tasks";
import { ensureDirectoriesExist, readPrettierConfig } from "./utils/preflight";

const start = async () => {
  await Promise.all([ensureDirectoriesExist(), readPrettierConfig()]);

  runTask(updateUserHandlersTask);
  runTask(updateUserConfigTask);
  runTask(updateUserSchemaTask);
};

export { start };
