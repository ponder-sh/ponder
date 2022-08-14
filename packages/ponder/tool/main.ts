import { buildDbSchema } from "./buildDbSchema";
import { buildGqlSchema } from "./buildGqlSchema";
import { buildHandlerContext } from "./buildHandlerContext";
import { getInitialLogs } from "./fetchLogs";
import { migrateDb } from "./migrateDb";
import { processLogs } from "./processLogs";
import { readUserConfig } from "./readUserConfig";
import { readUserSchema } from "./readUserSchema";
import { restartServer } from "./server";
import {
  generateContractTypes,
  generateEntityTypes,
  generateHandlerTypes,
  generateSchema,
} from "./typegen";
import { generateContextType } from "./typegen/generateContextType";

const main = async () => {
  const config = await readUserConfig();

  const userSchema = await readUserSchema();

  const gqlSchema = buildGqlSchema(userSchema);

  const dbSchema = buildDbSchema(userSchema);

  await generateContractTypes(config);
  console.log(`Generated contract types`);

  await generateContextType(config, dbSchema);
  console.log(`Generated context.d.ts`);

  await generateSchema(gqlSchema);
  console.log(`Generated schema.graphql`);

  await generateEntityTypes(gqlSchema);
  console.log(`Generated schema.d.ts`);

  const typeFileCount = await generateHandlerTypes(config);
  console.log(`Generated ${typeFileCount} handler type files`);

  const tableCount = await migrateDb(dbSchema);
  console.log(`Created ${tableCount} tables`);

  const initialLogsResult = await getInitialLogs(config);
  console.log(`Fetched ${initialLogsResult.length} logs`);

  const handlerContext = buildHandlerContext(config, dbSchema);

  await processLogs(initialLogsResult, handlerContext);

  restartServer(gqlSchema);
};

main().catch(console.error);
