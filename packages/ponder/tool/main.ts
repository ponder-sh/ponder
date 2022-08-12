import rawConfig from "../ponder.config.js";
import { parseConfig } from "./configParser";
import { getInitialLogs } from "./eventScraper";
import { typegen } from "./typegen";

const main = async () => {
  const config = parseConfig(rawConfig);

  const typegenResult = await typegen(config);
  console.log(`Successfully generated ${typegenResult.filesGenerated} types`);

  const initialLogsResult = await getInitialLogs(config);
  console.log(`Successfully fetched ${initialLogsResult.length} logs`);
};

main().catch(console.error);
