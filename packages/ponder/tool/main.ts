import { createDbSchema } from "./createDbSchema";
import { createGqlSchema } from "./createGqlSchema";
import { getInitialLogs } from "./fetchLogs";
import { generateContext } from "./generateContext";
import { generateEntityTypes } from "./generateEntityTypes";
import { generateHandlers } from "./generateHandlers";
import { generateSchema } from "./generateSchema";
import { getConfig } from "./getConfig";
import { migrateDb } from "./migrateDb";
import { parseUserSchema } from "./parseUserSchema";
import { processLogs } from "./processLogs";
import { startServer } from "./server";

const main = async () => {
  const config = await getConfig();

  const userSchema = await parseUserSchema();

  const gqlSchema = await createGqlSchema(userSchema);

  const dbSchema = await createDbSchema(userSchema);

  const tableCount = await migrateDb(dbSchema);
  console.log(`Created ${tableCount} tables`);

  await generateSchema(gqlSchema);
  console.log(`Generated schema.graphql`);
  await generateEntityTypes(gqlSchema);
  console.log(`Generated schema.ts`);

  const codeFileCount = await generateContext(dbSchema);
  console.log(`Generated ${codeFileCount} entity files`);
  const typeFileCount = await generateHandlers(config);
  console.log(`Generated ${typeFileCount} type files`);

  const initialLogsResult = await getInitialLogs(config);
  console.log(`Fetched ${initialLogsResult.length} logs`);

  await processLogs(initialLogsResult);

  startServer(gqlSchema);
};

main().catch(console.error);
