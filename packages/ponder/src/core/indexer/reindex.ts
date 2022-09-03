import { logger } from "@/common/logger";
import { endBenchmark, startBenchmark } from "@/common/utils";
import { buildLogWorker } from "@/core/buildLogWorker";
import type { Handlers } from "@/core/readHandlers";
import { PonderSchema } from "@/core/schema/types";
import { Source } from "@/sources/base";
import { Store } from "@/stores/base";

import { executeLogs } from "./executeLogs";

const handleReindex = async (
  store: Store,
  sources: Source[],
  schema: PonderSchema,
  userHandlers: Handlers
) => {
  const startHrt = startBenchmark();
  // logger.info(`\x1b[33m${"INDEXING..."}\x1b[0m`); // yellow

  await store.migrate(schema);

  // TODO: Rename and restructure this code path a bit.
  const logWorker = buildLogWorker(store, sources, schema, userHandlers);
  await executeLogs(sources, logWorker);

  const diff = endBenchmark(startHrt);

  logger.info(
    `\x1b[32m${`INDEXING COMPLETE (${diff})`}\x1b[0m`, // green
    "\n"
  );
};

export { handleReindex };
