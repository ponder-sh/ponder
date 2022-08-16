import type { DbSchema } from "./buildDbSchema";
import { buildHandlerContext } from "./buildHandlerContext";
import { createOrUpdateDbTables } from "./db";
import { endBenchmark, startBenchmark } from "./helpers";
import { logger } from "./logger";
import { fetchAndProcessLogs } from "./logs";
import type { PonderConfig } from "./readUserConfig";
import type { UserHandlers } from "./readUserHandlers";

const handleReindex = async (
  config: PonderConfig,
  dbSchema: DbSchema,
  userHandlers: UserHandlers
) => {
  const startHrt = startBenchmark();
  logger.info(`\x1b[33m${"REINDEXING..."}\x1b[0m`); // yellow

  await createOrUpdateDbTables(dbSchema);

  // TODO: Rename and restructure this code path a bit.
  const handlerContext = buildHandlerContext(config, dbSchema);
  await fetchAndProcessLogs(config, userHandlers, handlerContext);

  const diff = endBenchmark(startHrt);

  logger.info(
    `\x1b[32m${`REINDEXING COMPLETE (${diff})`}\x1b[0m`, // green
    "\n"
  );
};

export { handleReindex };
