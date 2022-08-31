import {
  runTask,
  updateSubgraphSchemaTask,
  updateSubgraphYamlTask,
} from "../subgraph-compat/tasks";
import { ensureDirectoriesExist, readPrettierConfig } from "../utils/preflight";

const start = async () => {
  await Promise.all([ensureDirectoriesExist(), readPrettierConfig()]);

  runTask(updateSubgraphYamlTask);
  runTask(updateSubgraphSchemaTask);
};

export { start };
