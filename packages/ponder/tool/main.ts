import { db } from "./db";
import { getInitialLogs } from "./fetchLogs";
import { generateContext } from "./generateContext";
import { generateHandlers } from "./generateHandlers";
import { getConfig } from "./getConfig";
import { migrateDb } from "./migrateDb";
import { processGqlSchema } from "./processGqlSchema";
import { processLogs } from "./processLogs";

const main = async () => {
  const config = await getConfig();

  const dbSchema = await processGqlSchema();

  const tableCount = await migrateDb(dbSchema);
  console.log(`Successfully created ${tableCount} tables`);

  const codeFileCount = await generateContext(dbSchema);
  console.log(`Successfully generated ${codeFileCount} entity files`);

  const typeFileCount = await generateHandlers(config);
  console.log(`Successfully generated ${typeFileCount} type files`);

  const initialLogsResult = await getInitialLogs(config);
  console.log(`Successfully fetched ${initialLogsResult.length} logs`);

  await processLogs(initialLogsResult);

  db.destroy();
};

main().catch(console.error);
