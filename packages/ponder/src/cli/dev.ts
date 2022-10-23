import { generateContextTypes } from "@/codegen/generateContextTypes";
import { generateContractTypes } from "@/codegen/generateContractTypes";
import { generateHandlerTypes } from "@/codegen/generateHandlerTypes";
import { logger } from "@/common/logger";
import { OPTIONS } from "@/common/options";
import { backfill } from "@/core/indexer/backfill";
import { indexLogs } from "@/core/indexer/indexLogs";
import { createLogQueue } from "@/core/indexer/logQueue";
import { Handlers, readHandlers } from "@/core/readHandlers";
import { readPonderConfig } from "@/core/readPonderConfig";
import { buildCacheStore, CacheStore } from "@/db/cacheStore";
import { buildDb, PonderDatabase } from "@/db/db";
import type { Network } from "@/networks/base";
import { buildNetworks } from "@/networks/buildNetworks";
import type { ResolvedPonderPlugin } from "@/core/plugin";
import { buildSources } from "@/sources/buildSources";
import type { EvmSource } from "@/sources/evm";

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

  // 2. Codegen
  generateContractTypes(state.sources); // This is a promise but no need to block on it
  generateHandlerTypes(state.sources);
  generateContextTypes(state.sources);

  // 2. Register plugins
  state.plugins = config.plugins;

  // 3. Call onSetup plugin callbacks
  for (const plugin of state.plugins) {
    if (!plugin.onSetup) return;

    const { watchFiles, handlerContext } = await plugin.onSetup({
      database: state.database,
      sources: state.sources,
      networks: state.networks,
      logger: logger,
      options: OPTIONS,
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

  state.handlers = await readHandlers();

  // TODO: transfer tasks that were added to the dummy logQueue
  const logQueue = createLogQueue({
    cacheStore: state.cacheStore,
    sources: state.sources,
    handlers: state.handlers,
    pluginHandlerContext: state.handlerContext,
  });

  const { startLiveIndexing } = await backfill({
    cacheStore: state.cacheStore,
    sources: state.sources,
    logQueue,
    isHotReload: state.isHotReload,
  });

  // Process historical / backfilled logs.
  await indexLogs({
    cacheStore: state.cacheStore,
    sources: state.sources,
    logQueue,
  });

  startLiveIndexing();

  // 5. Call onBackfillComplete plugin callbacks
  for (const plugin of state.plugins) {
    if (!plugin.onBackfillComplete) return;

    await plugin.onBackfillComplete();
  }

  state.isHotReload = true;
};
