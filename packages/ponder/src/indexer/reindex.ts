import type { DbSchema } from "@/db";
import { runMigrations } from "@/db";
import { buildLogWorker, executeLogs } from "@/indexer";
import type { PonderConfig } from "@/types";
import { endBenchmark, logger, startBenchmark } from "@/utils";

import type { UserHandlers } from "../readUserHandlers";

const handleReindex = async (
  config: PonderConfig,
  dbSchema: DbSchema,
  userHandlers: UserHandlers
) => {
  const startHrt = startBenchmark();
  // logger.info(`\x1b[33m${"INDEXING..."}\x1b[0m`); // yellow

  await runMigrations(dbSchema);

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
