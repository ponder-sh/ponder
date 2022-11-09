import EventEmitter from "node:events";
import { mkdirSync, watch, writeFileSync } from "node:fs";
import path from "node:path";

import { generateContextTypes } from "@/codegen/generateContextTypes";
import { generateContractTypes } from "@/codegen/generateContractTypes";
import { generateHandlerTypes } from "@/codegen/generateHandlerTypes";
import { formatPrettier } from "@/codegen/utils";
import { logger } from "@/common/logger";
import { OPTIONS } from "@/common/options";
import { isFileChanged } from "@/common/utils";
import { createHandlerQueue, HandlerQueue } from "@/core/queues/handlerQueue";
import { readHandlers } from "@/core/readHandlers";
import type { PonderConfig } from "@/core/readPonderConfig";
import { startBackfillQueues } from "@/core/tasks/startBackfillQueues";
import { startLiveBlockQueues } from "@/core/tasks/startLiveBlockQueues";
import { buildCacheStore, CacheStore } from "@/db/cacheStore";
import { buildDb, PonderDatabase } from "@/db/db";
import type { Network } from "@/networks/base";
import { buildNetworks } from "@/networks/buildNetworks";
import type { PonderPluginArgument, ResolvedPonderPlugin } from "@/plugin";
import { buildSources } from "@/sources/buildSources";
import type { EvmSource } from "@/sources/evm";

export class Ponder extends EventEmitter {
  // Ponder internal state
  sources: EvmSource[];
  networks: Network[];
  database: PonderDatabase;
  cacheStore: CacheStore;

  // Plugin state
  plugins: ResolvedPonderPlugin[];
  watchFiles: string[];
  pluginHandlerContext: Record<string, unknown>;

  // Backfill/indexing state
  latestProcessedTimestamp: number;
  handlerQueue?: HandlerQueue;

  constructor(config: PonderConfig) {
    super();
    this.database = buildDb(config);
    this.cacheStore = buildCacheStore(this.database);

    const { networks } = buildNetworks({
      config,
      cacheStore: this.cacheStore,
    });
    this.networks = networks;

    const { sources } = buildSources({ config, networks });
    this.sources = sources;

    this.plugins = config.plugins || [];
    this.watchFiles = [
      OPTIONS.HANDLERS_DIR_PATH,
      ...sources.map((s) => s.abiFilePath),
    ];
    this.pluginHandlerContext = {};

    this.latestProcessedTimestamp = 0;

    this.on("newBackfillLogs", () => {
      this.handleNewLogs();
    });

    this.on("backfillComplete", () => {
      this.handleNewLogs();
    });

    this.on("newFrontfillLogs", () => {
      this.handleNewLogs();
    });
  }

  async start() {
    this.setup();
    await this.setupPlugins();
    this.codegen();
    await this.backfill();
  }

  async dev() {
    this.setup();
    await this.setupPlugins();
    this.codegen();

    await this.setupHandlerQueue();

    // Not awaiting here!
    this.backfill();
  }

  setup() {
    mkdirSync(path.join(OPTIONS.GENERATED_DIR_PATH), { recursive: true });
    mkdirSync(path.join(OPTIONS.PONDER_DIR_PATH), { recursive: true });
  }

  codegen() {
    generateContractTypes(this.sources);
    generateHandlerTypes(this.sources);
    generateContextTypes(this.sources, this.pluginHandlerContext);
  }

  async backfill() {
    await this.cacheStore.migrate();

    const { latestBlockNumberByNetwork, resumeLiveBlockQueues } =
      await startLiveBlockQueues({
        sources: this.sources,
        cacheStore: this.cacheStore,
        ponder: this,
      });

    await startBackfillQueues({
      sources: this.sources,
      cacheStore: this.cacheStore,
      latestBlockNumberByNetwork,
      ponder: this,
    });

    this.emit("backfillComplete");

    resumeLiveBlockQueues();
  }

  async setupHandlerQueue() {
    const handlers = await readHandlers();

    this.handlerQueue = createHandlerQueue({
      cacheStore: this.cacheStore,
      sources: this.sources,
      handlers: handlers,
      pluginHandlerContext: this.pluginHandlerContext,
    });
  }

  async handleNewLogs() {
    if (!this.handlerQueue) {
      console.error(
        `Attempted to handle new block, but handler queue doesnt exist`
      );
      return;
    }

    // Whenever the live block handler queue emits the "newBlock" event,
    // check the cached metadata for all sources. If the minimum cached block across
    // all sources is greater than the lastHandledLogTimestamp, fetch the newly available
    // logs and add them to the queue.
    const cachedToTimestamps = await Promise.all(
      this.sources.map(async (source) => {
        const cachedIntervals = await this.cacheStore.getCachedIntervals(
          source.address
        );

        // Find the cached interval that includes the source's startBlock.
        const startingCachedInterval = cachedIntervals.find(
          (interval) =>
            interval.startBlock <= source.startBlock &&
            interval.endBlock >= source.startBlock
        );

        // If there is no cached data that includes the start block, return -1.
        if (!startingCachedInterval) return -1;

        return startingCachedInterval.endBlockTimestamp;
      })
    );

    // If any of the sources have no cached data yet, return early
    if (cachedToTimestamps.includes(-1)) {
      return;
    }

    const minimumCachedToTimestamp = Math.min(...cachedToTimestamps);

    // If the minimum cached timestamp across all sources is less than the
    // latest processed timestamp, we can't process any new logs.
    if (minimumCachedToTimestamp <= this.latestProcessedTimestamp) {
      return;
    }

    // KNOWN BUG: when this method gets triggered by the frontfill queue,
    // the "new" logs from the lates block get excluded here because
    // cacheStore.getLogs is exclusive to the right.
    const logs = await Promise.all(
      this.sources.map(async (source) => {
        return await this.cacheStore.getLogs(
          source.address,
          this.latestProcessedTimestamp,
          minimumCachedToTimestamp
        );
      })
    );

    const sortedLogs = logs.flat().sort((a, b) => a.logSortKey - b.logSortKey);

    console.log(
      `Pushing ${sortedLogs.length} logs to the queue [${this.latestProcessedTimestamp}, ${minimumCachedToTimestamp})`
    );

    for (const log of sortedLogs) {
      this.handlerQueue.push({ log });
    }

    this.latestProcessedTimestamp = minimumCachedToTimestamp;
  }

  // This reload method is not working - can be triggered multiple times
  // leading to multiple backfills happening at the same time.
  async reload() {
    if (this.handlerQueue) {
      this.handlerQueue.kill();
      if (!this.handlerQueue.idle()) {
        await this.handlerQueue.drained();
      }
    }

    await this.reloadPlugins();
    this.codegen();
    // this.runHandlers();
  }

  watch() {
    this.watchFiles.forEach((fileOrDirName) => {
      watch(fileOrDirName, { recursive: true }, (_, fileName) => {
        const fullPath =
          path.basename(fileOrDirName) === fileName
            ? fileOrDirName
            : path.join(fileOrDirName, fileName);

        logger.debug("File changed:");
        logger.debug({ fileOrDirName, fileName, fullPath });

        if (isFileChanged(fullPath)) {
          logger.info("");
          logger.info(`\x1b[35m${`Detected change in: ${fileName}`}\x1b[0m`); // yellow

          this.reload();
        } else {
          logger.debug("File content not changed, not reloading");
        }
      });
    });
  }

  /* Plugin-related methods */

  async setupPlugins() {
    for (const plugin of this.plugins) {
      if (!plugin.setup) return;
      await plugin.setup(this.getPluginArgument());
    }
  }

  async reloadPlugins() {
    for (const plugin of this.plugins) {
      if (!plugin.reload) return;
      await plugin.reload(this.getPluginArgument());
    }
  }

  getPluginArgument(): PonderPluginArgument {
    return {
      database: this.database,
      sources: this.sources,
      networks: this.networks,
      logger: logger,
      options: OPTIONS,
      prettier: formatPrettier,

      // Actions
      // TODO: Maybe change this... seems meh
      addWatchFile: (filePath: string) => this.addWatchFile(filePath),
      emitFile: (filePath: string, contents: string | Buffer) =>
        this.emitFile(filePath, contents),
      addToHandlerContext: (handlerContext: Record<string, unknown>) =>
        this.addToHandlerContext(handlerContext),
    };
  }

  addWatchFile(filePath: string) {
    this.watchFiles.push(filePath);
  }

  emitFile(filePath: string, contents: string | Buffer) {
    writeFileSync(filePath, contents);
  }

  addToHandlerContext(handlerContext: Record<string, unknown>) {
    const duplicatedHandlerContextKeys = Object.keys(
      this.pluginHandlerContext
    ).filter((key) => Object.keys(handlerContext).includes(key));

    if (duplicatedHandlerContextKeys.length > 0) {
      throw new Error(
        `Duplicate handler context key from plugins: ${duplicatedHandlerContextKeys}`
      );
    }

    this.pluginHandlerContext = {
      ...this.pluginHandlerContext,
      ...handlerContext,
    };
  }
}
