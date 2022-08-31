import type { DbSchema } from "../db";
import { runMigrations } from "../db";
import { executeLogs } from "../indexer";
import { endBenchmark, startBenchmark } from "../utils/helpers";
import { logger } from "../utils/logger";
import type { GraphHandlers } from "./buildHandlers";
import { buildLogWorker } from "./buildLogWorker";
import type { GraphCompatPonderConfig } from "./readSubgraphYaml";

const handleReindex = async (
  config: GraphCompatPonderConfig,
  dbSchema: DbSchema,
  handlers: GraphHandlers
) => {
  const startHrt = startBenchmark();
  // logger.info(`\x1b[33m${"INDEXING..."}\x1b[0m`); // yellow

  await runMigrations(dbSchema);

  // TODO: Rename and restructure this code path a bit.
  const logWorker = buildLogWorker(config, handlers);
  await executeLogs(config, logWorker);

  const diff = endBenchmark(startHrt);

  logger.info(
    `\x1b[32m${`INDEXING COMPLETE (${diff})`}\x1b[0m`, // green
    "\n"
  );
};

export { handleReindex };
