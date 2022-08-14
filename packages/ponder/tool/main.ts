import { buildHandlerContext } from "./buildHandlerContext";
import { createDbSchema } from "./createDbSchema";
import { createGqlSchema } from "./createGqlSchema";
import { getInitialLogs } from "./fetchLogs";
import { generateContextType } from "./generateContextType";
import { generateContractTypes } from "./generateContractTypes";
import { generateEntityTypes } from "./generateEntityTypes";
import { generateHandlerTypes } from "./generateHandlerTypes";
import { generateSchema } from "./generateSchema";
import { migrateDb } from "./migrateDb";
import { processLogs } from "./processLogs";
import { readUserConfig } from "./readUserConfig";
import { readUserSchema } from "./readUserSchema";
import { startServer } from "./server";

const main = async () => {
  const config = await readUserConfig();

  const userSchema = await readUserSchema();

  const gqlSchema = createGqlSchema(userSchema);

  const dbSchema = createDbSchema(userSchema);

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

  startServer(gqlSchema);
};

main().catch(console.error);
