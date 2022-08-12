import rawConfig from "../ponder.config.js";
import { codegen } from "./codegen";
import { parseConfig } from "./configParser";
import { getInitialLogs } from "./fetchLogs";
import { processLogs } from "./processLogs";
import { typegen } from "./typegen";

const main = async () => {
  const config = parseConfig(rawConfig);

  const typegenResult = await typegen(config);
  console.log(`Successfully generated ${typegenResult.filesGenerated} types`);

  const initialLogsResult = await getInitialLogs(config);
  console.log(`Successfully fetched ${initialLogsResult.length} logs`);

  await codegen(config);

  await processLogs(initialLogsResult);
};

main().catch(console.error);
