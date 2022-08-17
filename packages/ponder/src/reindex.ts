import type { DbSchema } from "./buildDbSchema";
import { createOrUpdateDbTables } from "./db";
import { executeLogs } from "./logs";
import { buildLogWorker } from "./logs/buildLogWorker";
import type { PonderConfig } from "./readUserConfig";
import type { UserHandlers } from "./readUserHandlers";
import { endBenchmark, startBenchmark } from "./utils/helpers";
import { logger } from "./utils/logger";

const handleReindex = async (
  config: PonderConfig,
  dbSchema: DbSchema,
  userHandlers: UserHandlers
) => {
  const startHrt = startBenchmark();
  // logger.info(`\x1b[33m${"INDEXING..."}\x1b[0m`); // yellow

  await createOrUpdateDbTables(dbSchema);

  // TODO: Rename and restructure this code path a bit.
  const logWorker = buildLogWorker(config, dbSchema, userHandlers);
  await executeLogs(config, logWorker);

  const diff = endBenchmark(startHrt);

  logger.info(
    `\x1b[32m${`INDEXING COMPLETE (${diff})`}\x1b[0m`, // green
    "\n"
  );
};

export { handleReindex };
