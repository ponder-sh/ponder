import { logger } from "@/common/logger";
import { endBenchmark, startBenchmark } from "@/common/utils";
import { buildLogWorker } from "@/core/indexer/buildLogWorker";
import type { Handlers } from "@/core/readHandlers";
import { PonderSchema } from "@/core/schema/types";
import { Source } from "@/sources/base";
import { Store } from "@/stores/base";

import { cacheStore } from "./cacheStore";
import { executeLogs } from "./executeLogs";

// This is a pretty hacky way to get cache hit stats that works with the dev server.
export let reindexStatistics = {
  logRequestCount: 0,
  blockRequestCount: 0,
  cacheHitRate: 0,
};

let isInitialIndexing = true;

const handleReindex = async (
  store: Store,
  sources: Source[],
  schema: PonderSchema,
  userHandlers: Handlers
) => {
  const startHrt = startBenchmark();
  logger.info(
    `\x1b[33m${`${
      isInitialIndexing ? "FETCHING" : "PROCESSING"
    } HISTORICAL LOGS...`}\x1b[0m`
  ); // yellow

  // Prepare user store.
  await store.migrate(schema);

  // Prepare cache store.
  await cacheStore.migrate();

  // TODO: Rename and restructure this code path a bit.
  const logWorker = buildLogWorker(store, sources, schema, userHandlers);
  await executeLogs(sources, logWorker);

  const diff = endBenchmark(startHrt);

  const rpcRequestCount =
    reindexStatistics.logRequestCount + reindexStatistics.blockRequestCount;
  const cacheHitRate = Math.round(reindexStatistics.cacheHitRate * 1000) / 10;

  logger.info(
    `\x1b[32m${`${
      isInitialIndexing ? "FETCHED" : "PROCESSED"
    } HISTORICAL LOGS (${diff}, ${rpcRequestCount} RPC request${
      rpcRequestCount === 1 ? "" : "s"
    }, ${
      cacheHitRate >= 99.9 ? ">99.9" : cacheHitRate
    }% cache hit rate)`}\x1b[0m`, // green
    "\n"
  );

  reindexStatistics = {
    logRequestCount: 0,
    blockRequestCount: 0,
    cacheHitRate: 0,
  };
  isInitialIndexing = false;
};

export { handleReindex };
