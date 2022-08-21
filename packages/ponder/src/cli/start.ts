import { readSubgraphYaml } from "../compatibility/readSubgraphYaml";
import { CONFIG } from "../config";
import {
  runTask,
  updateUserConfigTask,
  // updateUserHandlersTask,
  updateUserSchemaTask,
} from "../tasks";
import { ensureDirectoriesExist, readPrettierConfig } from "../utils/preflight";

const start = async () => {
  if (CONFIG.GRAPH_COMPAT_ENABLED) {
    await readSubgraphYaml();
    return;
  }

  await Promise.all([ensureDirectoriesExist(), readPrettierConfig()]);

  // runTask(updateUserHandlersTask);
  runTask(updateUserConfigTask);
  runTask(updateUserSchemaTask);
};

export { start };
