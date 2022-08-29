import { createOrUpdateDbTables } from "../db";
import { buildDbSchema } from "../db/buildDbSchema";
import { executeLogs } from "../indexer";
import { buildLogWorker } from "../subgraph-compat/buildLogWorker";
import { getRpcUrlMap } from "../subgraph-compat/getRpcUrlMap";
import { readMappings } from "../subgraph-compat/readMappings";
import { readSubgraphSchema } from "../subgraph-compat/readSubgraphSchema";
import { readSubgraphYaml } from "../subgraph-compat/readSubgraphYaml";

const start = async () => {
  const rpcUrlMap = getRpcUrlMap();

  const { graphCompatPonderConfig, graphSchemaFilePath } =
    await readSubgraphYaml(rpcUrlMap);

  console.log({ graphCompatPonderConfig, graphSchemaFilePath });

  const userSchema = await readSubgraphSchema(graphSchemaFilePath);

  console.log({ userSchema });

  const handlers = await readMappings(graphCompatPonderConfig);

  console.log({ handlers });

  const dbSchema = buildDbSchema(userSchema);

  await createOrUpdateDbTables(dbSchema);

  const logWorker = buildLogWorker(graphCompatPonderConfig, dbSchema, handlers);

  await executeLogs(graphCompatPonderConfig, logWorker);

  return;
};

export { start };
