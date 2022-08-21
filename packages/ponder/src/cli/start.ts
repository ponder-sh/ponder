import { readMappings } from "../compatibility/readMappings";
import { readSubgraphSchema } from "../compatibility/readSubgraphSchema";
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
    const { graphCompatPonderConfig, graphSchemaFilePath } =
      await readSubgraphYaml();

    console.log({ graphCompatPonderConfig, graphSchemaFilePath });

    const userSchema = await readSubgraphSchema(graphSchemaFilePath);

    console.log({ userSchema });

    const mappings = await readMappings(graphCompatPonderConfig);

    return;
  }

  await Promise.all([ensureDirectoriesExist(), readPrettierConfig()]);

  // runTask(updateUserHandlersTask);
  runTask(updateUserConfigTask);
  runTask(updateUserSchemaTask);
};

export { start };
