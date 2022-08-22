import { readMappings } from "../compatibility/readMappings";
import { readSubgraphSchema } from "../compatibility/readSubgraphSchema";
import { readSubgraphYaml } from "../compatibility/readSubgraphYaml";
import { CONFIG } from "../config";
import { createOrUpdateDbTables } from "../db";
import { buildDbSchema } from "../db/buildDbSchema";
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

    const handlers = await readMappings(graphCompatPonderConfig);

    const dbSchema = buildDbSchema(userSchema);

    await createOrUpdateDbTables(dbSchema);

    // const logWorker = buildLogWorker(config, dbSchema, userHandlers);
    // await executeLogs(config, logWorker);

    return;
  }

  await Promise.all([ensureDirectoriesExist(), readPrettierConfig()]);

  // runTask(updateUserHandlersTask);
  runTask(updateUserConfigTask);
  runTask(updateUserSchemaTask);
};

export { start };
