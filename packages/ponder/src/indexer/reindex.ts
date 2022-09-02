import { runMigrations } from "@/db";
import { buildLogWorker, executeLogs } from "@/indexer";
import type { PonderConfig, Schema } from "@/types";
import { endBenchmark, logger, startBenchmark } from "@/utils";

import type { UserHandlers } from "../readUserHandlers";

const handleReindex = async (
  config: PonderConfig,
  schema: Schema,
  userHandlers: UserHandlers
) => {
  const startHrt = startBenchmark();
  // logger.info(`\x1b[33m${"INDEXING..."}\x1b[0m`); // yellow

  await runMigrations(schema);

  // TODO: Rename and restructure this code path a bit.
  const logWorker = buildLogWorker(config, schema, userHandlers);
  await executeLogs(config, logWorker);

  const diff = endBenchmark(startHrt);

  logger.info(
    `\x1b[32m${`INDEXING COMPLETE (${diff})`}\x1b[0m`, // green
    "\n"
  );
};

export { handleReindex };
