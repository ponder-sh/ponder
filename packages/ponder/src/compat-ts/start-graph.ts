import { createOrUpdateDbTables } from "../db";
import { buildDbSchema } from "../db/buildDbSchema";
import { executeLogs } from "../logs";
import { buildLogWorker } from "./buildLogWorker";
import { getRpcUrlMap } from "./getRpcUrlMap";
import { readMappings } from "./readMappings";
import { readSubgraphSchema } from "./readSubgraphSchema";
import { readSubgraphYaml } from "./readSubgraphYaml";

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

  // await executeLogs(graphCompatPonderConfig, logWorker);

  return;
};

export { start };
