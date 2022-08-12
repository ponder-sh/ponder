import { db } from "./db";
import { getInitialLogs } from "./fetchLogs";
import { getConfig } from "./getConfig";
import { migrateDb } from "./migrateDb";
import { processLogs } from "./processLogs";
import { codegen } from "./typegen";

const main = async () => {
  const config = await getConfig();

  const tablesCount = await migrateDb();
  console.log(`Successfully created ${tablesCount} tables`);

  const generatedFileCount = await codegen(config);
  console.log(`Successfully generated ${generatedFileCount} type files`);

  const initialLogsResult = await getInitialLogs(config);
  console.log(`Successfully fetched ${initialLogsResult.length} logs`);

  await processLogs(initialLogsResult);

  db.destroy();
};

main().catch(console.error);
