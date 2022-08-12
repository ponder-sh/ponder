import { toolConfig } from "./config";
import { db } from "./db";
import { getInitialLogs } from "./fetchLogs";
import { migrateDb } from "./migrateDb";
import { processLogs } from "./processLogs";
import { processSchema } from "./processSchema";
import { parseConfig } from "./processUserConfig";
import { typegen } from "./typechain";
import { codegen } from "./typegen";

const main = async () => {
  // const { default: rawConfig } = await import(toolConfig.pathToUserConfigFile);
  // const config = parseConfig(rawConfig);

  // const typegenResult = await typegen(config);
  // console.log(`Successfully generated ${typegenResult.filesGenerated} types`);

  // const initialLogsResult = await getInitialLogs(config);
  // console.log(`Successfully fetched ${initialLogsResult.length} logs`);

  // await codegen(config);

  // await processLogs(initialLogsResult);

  // await processSchema();

  await migrateDb();

  db.destroy();
};

main().catch(console.error);
