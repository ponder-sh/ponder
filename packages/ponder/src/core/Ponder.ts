import { generateContextTypes } from "@/codegen/generateContextTypes";
import { generateContractTypes } from "@/codegen/generateContractTypes";
import { generateHandlerTypes } from "@/codegen/generateHandlerTypes";
import { logger } from "@/common/logger";
import { OPTIONS } from "@/common/options";
import { backfill } from "@/core/indexer/backfill";
import { indexLogs } from "@/core/indexer/indexLogs";
import { createLogQueue, LogQueue } from "@/core/indexer/logQueue";
import { readHandlers } from "@/core/readHandlers";
import { PonderConfig, readPonderConfig } from "@/core/readPonderConfig";
import { buildCacheStore, CacheStore } from "@/db/cacheStore";
import { buildDb, PonderDatabase } from "@/db/db";
import type { Network } from "@/networks/base";
import { buildNetworks } from "@/networks/buildNetworks";
import type { ResolvedPonderPlugin } from "@/plugin";
import { buildSources } from "@/sources/buildSources";
import type { EvmSource } from "@/sources/evm";

export class Ponder {
  // Constructor
  sources: EvmSource[];
  networks: Network[];
  database: PonderDatabase;
  cacheStore: CacheStore;
  plugins: ResolvedPonderPlugin[];

  // Backfill/indexing
  isHotReload = false;
  logQueue?: LogQueue;

  constructor(config: PonderConfig) {
    this.plugins = config.plugins;
    this.database = buildDb(config);
    this.cacheStore = buildCacheStore(this.database);

    const { networks } = buildNetworks({
      config,
      cacheStore: this.cacheStore,
    });
    this.networks = networks;

    const { sources } = buildSources({ config, networks });
    this.sources = sources;
  }

  async start() {
    await this.codegen();
    await this.createLogQueue();
    await this.backfill();
  }

  async dev() {
    await this.codegen();
    await this.createLogQueue();
    await this.backfill();
  }

  async codegen() {
    await generateContractTypes(this.sources);
    generateHandlerTypes(this.sources);
    generateContextTypes(this.sources);
  }

  async createLogQueue() {
    if (this.logQueue) {
      this.logQueue.killAndDrain();
    }

    const handlers = await readHandlers();

    this.logQueue = createLogQueue({
      cacheStore: this.cacheStore,
      sources: this.sources,
      handlers: handlers,
      pluginHandlerContext: {}, // TODO: actually get plugin context properties here
    });
  }

  async backfill() {
    if (!this.logQueue) {
      throw new Error(`Cannot begin backfill before creating log queue`);
    }

    const { startLiveIndexing } = await backfill({
      cacheStore: this.cacheStore,
      sources: this.sources,
      logQueue: this.logQueue,
      isHotReload: this.isHotReload,
    });

    // Process historical / backfilled logs.
    await indexLogs({
      cacheStore: this.cacheStore,
      sources: this.sources,
      logQueue: this.logQueue,
    });

    startLiveIndexing();

    this.isHotReload = true;
  }
}
