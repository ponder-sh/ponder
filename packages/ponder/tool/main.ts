import { createDbSchema } from "./createDbSchema";
import { createGqlSchema } from "./createGqlSchema";
import { getInitialLogs } from "./fetchLogs";
import { generateContext } from "./generateContext";
import { generateHandlers } from "./generateHandlers";
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
  console.log(`Successfully created ${tableCount} tables`);

  const codeFileCount = await generateContext(dbSchema);
  console.log(`Successfully generated ${codeFileCount} entity files`);

  const typeFileCount = await generateHandlers(config);
  console.log(`Successfully generated ${typeFileCount} type files`);

  const initialLogsResult = await getInitialLogs(config);
  console.log(`Successfully fetched ${initialLogsResult.length} logs`);

  await processLogs(initialLogsResult);

  startServer(gqlSchema);
};

main().catch(console.error);
