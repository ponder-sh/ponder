import { createOrUpdateDbTables } from "../db";
import { buildDbSchema } from "../db/buildDbSchema";
import { buildLogWorker } from "./buildLogWorker";
import { readMappings } from "./readMappings";
import { readSubgraphSchema } from "./readSubgraphSchema";
import { readSubgraphYaml } from "./readSubgraphYaml";

const start = async () => {
  const { graphCompatPonderConfig, graphSchemaFilePath } =
    await readSubgraphYaml();

  console.log({ graphCompatPonderConfig, graphSchemaFilePath });

  const userSchema = await readSubgraphSchema(graphSchemaFilePath);

  console.log({ userSchema });

  const handlers = await readMappings(graphCompatPonderConfig);

  const dbSchema = buildDbSchema(userSchema);

  await createOrUpdateDbTables(dbSchema);

  const logWorker = buildLogWorker(graphCompatPonderConfig, dbSchema, handlers);

  // await executeLogs(config, logWorker);

  return;
};

export { start };
