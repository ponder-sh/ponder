import { mkdirSync, watch, writeFileSync } from "node:fs";
import path from "node:path";

import { generateContextTypes } from "@/codegen/generateContextTypes";
import { generateContractTypes } from "@/codegen/generateContractTypes";
import { generateHandlerTypes } from "@/codegen/generateHandlerTypes";
import { logger } from "@/common/logger";
import { OPTIONS } from "@/common/options";
import { isFileChanged } from "@/common/utils";
import { backfill } from "@/core/indexer/backfill";
import { indexLogs } from "@/core/indexer/indexLogs";
import { createLogQueue, LogQueue } from "@/core/indexer/logQueue";
import type { PonderPluginArgument, ResolvedPonderPlugin } from "@/core/plugin";
import { readHandlers } from "@/core/readHandlers";
import type { PonderConfig } from "@/core/readPonderConfig";
import { buildCacheStore, CacheStore } from "@/db/cacheStore";
import { buildDb, PonderDatabase } from "@/db/db";
import type { Network } from "@/networks/base";
import { buildNetworks } from "@/networks/buildNetworks";
import { buildSources } from "@/sources/buildSources";
import type { EvmSource } from "@/sources/evm";

export class Ponder {
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
  isReload: boolean;
  logQueue?: LogQueue;

  constructor(config: PonderConfig) {
    this.database = buildDb(config);
    this.cacheStore = buildCacheStore(this.database);

    const { networks } = buildNetworks({
      config,
      cacheStore: this.cacheStore,
    });
    this.networks = networks;

    const { sources } = buildSources({ config, networks });
    this.sources = sources;

    this.plugins = config.plugins;
    this.watchFiles = [
      OPTIONS.HANDLERS_DIR_PATH,
      ...sources.map((s) => s.abiFilePath),
    ];
    this.pluginHandlerContext = {};
    this.isReload = false;
  }

  async start() {
    await this.setup();
    await this.setupPlugins();
    await this.codegen();
    await this.createLogQueue();
    await this.backfill();
  }

  async dev() {
    await this.setup();
    await this.setupPlugins();
    await this.codegen();
    await this.createLogQueue();
    await this.backfill();

    this.watch();
  }

  async setup() {
    mkdirSync(path.join(OPTIONS.GENERATED_DIR_PATH), { recursive: true });
    mkdirSync(path.join(OPTIONS.PONDER_DIR_PATH), { recursive: true });
  }

  async codegen() {
    generateContractTypes(this.sources);
    generateHandlerTypes(this.sources);
    generateContextTypes(this.sources, this.pluginHandlerContext);
  }

  async createLogQueue() {
    const handlers = await readHandlers();

    this.logQueue = createLogQueue({
      cacheStore: this.cacheStore,
      sources: this.sources,
      handlers: handlers,
      pluginHandlerContext: this.pluginHandlerContext,
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
      isHotReload: this.isReload,
    });

    // Process historical / backfilled logs.
    await indexLogs({
      cacheStore: this.cacheStore,
      sources: this.sources,
      logQueue: this.logQueue,
    });

    startLiveIndexing();
  }

  async reload() {
    this.logQueue?.killAndDrain();
    this.isReload = true;

    await this.reloadPlugins();
    await this.codegen();
    await this.createLogQueue();
    await this.backfill();
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
