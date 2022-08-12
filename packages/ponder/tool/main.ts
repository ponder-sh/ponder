import { toolConfig } from "./config";
import { getInitialLogs } from "./fetchLogs";
import { processLogs } from "./processLogs";
import { parseConfig } from "./processUserConfig";
import { typegen } from "./typechain";
import { codegen } from "./typegen";

const main = async () => {
  const { default: rawConfig } = await import(toolConfig.pathToUserConfigFile);
  const config = parseConfig(rawConfig);

  const typegenResult = await typegen(config);
  console.log(`Successfully generated ${typegenResult.filesGenerated} types`);

  const initialLogsResult = await getInitialLogs(config);
  console.log(`Successfully fetched ${initialLogsResult.length} logs`);

  await codegen(config);

  await processLogs(initialLogsResult);
};

main().catch(console.error);
