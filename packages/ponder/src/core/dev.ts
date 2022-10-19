import { logger } from "@/common/logger";
import { ensureDirectoriesExist, readPrettierConfig } from "@/common/utils";
import { graphqlPlugin } from "@/graphql";
import type { Network } from "@/networks/base";
import { buildNetworks } from "@/networks/buildNetworks";
import type { ResolvedPonderPlugin } from "@/plugin";
import { buildSources } from "@/sources/buildSources";
import type { EvmSource } from "@/sources/evm";
import { buildCacheStore, CacheStore } from "@/stores/baseCacheStore";
import { buildDb, PonderDatabase } from "@/stores/db";

import { backfill } from "./indexer/backfill";
import { indexLogs } from "./indexer/indexLogs";
import { createLogQueue, LogQueue } from "./indexer/logQueue";
import { Handlers, readHandlers } from "./readHandlers";
import { readPonderConfig } from "./readPonderConfig";

const state: {
  database?: PonderDatabase;
  sources?: EvmSource[];
  networks?: Network[];

  cacheStore?: CacheStore;
  handlers?: Handlers;

  plugins: ResolvedPonderPlugin[];

  watchFiles: string[];
  handlerContext: Record<string, unknown>;

  isHotReload: boolean;
} = {
  plugins: [],
  watchFiles: [],
  handlerContext: {},
  isHotReload: false,
};

export const dev = async () => {
  ensureDirectoriesExist();
  await readPrettierConfig();

  // 1. Read `ponder.config.js` and build db, networks & sources
  // 4. Register plugins
  // 5. Call onSetup plugin callbacks
  // 6. ?? Register file watching
  // 7. Kick off backfill
  // 8. Call onBackfillComplete plugin callbacks
  // 9. Kick off log processing
  // 10. Call onBackfillHandlersComplete plugin callbacks

  // 1) Read `ponder.config.js` and build database, networks, sources
  const config = readPonderConfig();

  state.watchFiles = [];

  if (!state.database || !state.cacheStore) {
    state.database = buildDb(config);
    state.cacheStore = buildCacheStore(state.database);
  }

  const { networks } = buildNetworks({
    config,
    cacheStore: state.cacheStore,
  });
  state.networks = networks;

  const { sources } = buildSources({ config, networks });
  state.sources = sources;

  // 2. Register plugins
  state.plugins.push(graphqlPlugin());

  // 3. Call onSetup plugin callbacks
  for (const plugin of state.plugins) {
    if (!plugin.onSetup) return;

    const { watchFiles, handlerContext } = await plugin.onSetup({
      database: state.database,
      sources: state.sources,
      networks: state.networks,
      logger: logger,
    });

    if (watchFiles) {
      state.watchFiles.push(...watchFiles);
    }

    if (handlerContext) {
      state.handlerContext = {
        ...state.handlerContext,
        ...handlerContext,
      };
    }
  }

  // 4. Begin backfill

  // This is a hack required to create the liveBlockRequestQueue BEFORE
  // creating the logQueue. The liveBlockRequestQueue calls
  // stableLogQueueObject.logQueue.push(task) whenever it processes a new block.
  // Would be better if fastq allowed you to replace a worker function on the fly.
  const stableLogQueueObject = {
    logQueue: null as unknown as LogQueue,
  };

  const { liveNetworkInfos } = await backfill({
    cacheStore: state.cacheStore,
    sources: state.sources,
    stableLogQueueObject: stableLogQueueObject,
    isHotReload: state.isHotReload,
  });

  state.handlers = await readHandlers();

  // TODO: transfer tasks that were added to the dummy logQueue
  const logQueue = createLogQueue({
    cacheStore: state.cacheStore,
    sources: state.sources,
    handlers: state.handlers,
    pluginHandlerContext: state.handlerContext,
  });

  // Now that the logQueue exists, override the null property with the actual queue.
  stableLogQueueObject.logQueue = logQueue;

  // Process historical / backfilled logs.
  await indexLogs({
    cacheStore: state.cacheStore,
    sources: state.sources,
    logQueue,
  });

  // Begin processing live blocks for all source groups. This includes
  // any blocks that were fetched and enqueued during the backfill.
  liveNetworkInfos.forEach((info) => {
    info.liveBlockRequestQueue.resume();
  });

  // 5. Call onBackfillComplete plugin callbacks
  for (const plugin of state.plugins) {
    if (!plugin.onBackfillComplete) return;

    await plugin.onBackfillComplete();
  }

  state.isHotReload = true;
};
