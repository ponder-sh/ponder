import { buildDbSchema, runMigrations } from "../db";
import { buildGqlSchema } from "../graphql";
import { executeLogs } from "../indexer";
import { startServer } from "../startServer";
import { buildHandlers } from "../subgraph-compat/buildHandlers";
import { buildLogWorker } from "../subgraph-compat/buildLogWorker";
import { getRpcUrlMap } from "../subgraph-compat/getRpcUrlMap";
import { readSubgraphSchema } from "../subgraph-compat/readSubgraphSchema";
import { readSubgraphYaml } from "../subgraph-compat/readSubgraphYaml";

const start = async () => {
  const rpcUrlMap = getRpcUrlMap();

  const { graphCompatPonderConfig, graphSchemaFilePath } =
    await readSubgraphYaml(rpcUrlMap);

  const userSchema = await readSubgraphSchema(graphSchemaFilePath);
  console.log({ userSchema });

  const dbSchema = buildDbSchema(userSchema);
  const gqlSchema = buildGqlSchema(userSchema);

  const handlers = await buildHandlers(graphCompatPonderConfig);

  await runMigrations(dbSchema);

  const logWorker = buildLogWorker(graphCompatPonderConfig, dbSchema, handlers);

  await executeLogs(graphCompatPonderConfig, logWorker);

  startServer(graphCompatPonderConfig, gqlSchema);

  return;
};

export { start };
