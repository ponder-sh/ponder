import { watch } from "node:fs";
import path from "node:path";
import pico from "picocolors";

import type { ResolvedPonderConfig } from "@/buildPonderConfig";
import { generateApp } from "@/codegen/generateApp";
import { generateAppType } from "@/codegen/generateAppType";
import { generateContractTypes } from "@/codegen/generateContractTypes";
import { logger, logMessage, MessageKind, PonderLogger } from "@/common/logger";
import type { PonderOptions } from "@/common/options";
import {
  endBenchmark,
  formatEta,
  formatPercentage,
  startBenchmark,
} from "@/common/utils";
import { isFileChanged } from "@/common/utils";
import { buildCacheStore, CacheStore } from "@/db/cache/cacheStore";
import { buildDb, PonderDatabase } from "@/db/db";
import { buildEntityStore, EntityStore } from "@/db/entity/entityStore";
import { createHandlerQueue, HandlerQueue } from "@/handlers/handlerQueue";
import { readHandlers } from "@/handlers/readHandlers";
import { getLatestBlockForNetwork } from "@/indexer/tasks/getLatestBlockForNetwork";
import { getLogs } from "@/indexer/tasks/getLogs";
import { startBackfill } from "@/indexer/tasks/startBackfill";
import { startFrontfill } from "@/indexer/tasks/startFrontfill";
import type { Network } from "@/networks/buildNetworks";
import { buildNetworks } from "@/networks/buildNetworks";
import { buildSchema } from "@/schema/buildSchema";
import { readGraphqlSchema } from "@/schema/readGraphqlSchema";
import type { Schema } from "@/schema/types";
import { buildSources } from "@/sources/buildSources";
import type { EvmSource } from "@/sources/evm";
import { EventEmitter, PonderEvents, PonderPlugin } from "@/types";
import type { UiState } from "@/ui/app";
import { getUiState, hydrateUi, render, unmount } from "@/ui/app";

export class Ponder extends EventEmitter<PonderEvents> {
  options: PonderOptions;
  config: ResolvedPonderConfig;
  logger: PonderLogger = logger;

  // Config-derived services
  sources: EvmSource[];
  networks: Network[];
  database: PonderDatabase;
  cacheStore: CacheStore;
  entityStore: EntityStore;

  // Reload-able services
  schema?: Schema;
  handlerQueue?: HandlerQueue;

  // Indexer state
  frontfillNetworks: {
    network: Network;
    latestBlockNumber: number;
  }[] = [];

  // Handler state
  isAddingLogs = false;
  isProcessingLogs = false;
  logsAddedToTimestamp = 0;
  currentEventBlockTag = 0;

  // Hot reloading
  killFrontfillQueues?: () => void;
  killBackfillQueues?: () => void;
  killWatchers?: () => void;

  // Plugins
  plugins: PonderPlugin[] = [];

  // UI
  ui: UiState;
  renderInterval?: NodeJS.Timer;
  etaInterval?: NodeJS.Timer;

  constructor({
    options,
    config,
  }: {
    options: PonderOptions;
    config: ResolvedPonderConfig;
  }) {
    super();
    this.options = options;
    this.config = config;

    this.on("dev_error", this.dev_error);

    this.on("backfill_networkConnected", this.backfill_networkConnected);
    this.on("backfill_sourceStarted", this.backfill_sourceStarted);
    this.on("backfill_logTasksAdded", this.backfill_logTasksAdded);
    this.on("backfill_blockTasksAdded", this.backfill_blockTasksAdded);
    this.on("backfill_logTaskFailed", this.backfill_logTaskFailed);
    this.on("backfill_blockTaskFailed", this.backfill_blockTaskFailed);
    this.on("backfill_logTaskDone", this.backfill_logTaskDone);
    this.on("backfill_blockTaskDone", this.backfill_blockTaskDone);
    this.on("backfill_newLogs", this.backfill_newLogs);

    this.on("frontfill_taskFailed", this.frontfill_taskFailed);
    this.on("frontfill_newLogs", this.frontfill_newLogs);

    this.on("indexer_taskStarted", this.indexer_taskStarted);
    this.on("indexer_taskDone", this.indexer_taskDone);

    this.ui = getUiState(this.options);

    this.database = buildDb({ ponder: this });
    this.cacheStore = buildCacheStore({ ponder: this });
    this.entityStore = buildEntityStore({ ponder: this });

    this.networks = buildNetworks({ ponder: this });
    this.sources = buildSources({ ponder: this });

    this.plugins = (
      (this.config.plugins as ((ponder: Ponder) => PonderPlugin)[]) || []
    ).map((plugin) => plugin(this));

    hydrateUi({ ui: this.ui, sources: this.sources });
  }

  // --------------------------- PUBLIC METHODS --------------------------- //

  async start() {
    await this.setup();
    await this.getLatestBlockNumbers();
    this.frontfill();
    await this.backfill();
  }

  async dev() {
    await this.setup();
    await this.getLatestBlockNumbers();
    this.frontfill();
    this.watch();
    await this.backfill();
  }

  codegen() {
    this.loadSchema();
    generateApp({ ponder: this });
    generateAppType({ ponder: this });
    generateContractTypes({ ponder: this });
  }

  async kill() {
    unmount();
    clearInterval(this.renderInterval);
    clearInterval(this.etaInterval);
    this.handlerQueue?.kill();
    this.killFrontfillQueues?.();
    this.killBackfillQueues?.();
    this.killWatchers?.();
    await this.teardownPlugins();
  }

  // --------------------------- SETUP & RELOADING --------------------------- //

  async setup() {
    this.renderInterval = setInterval(() => {
      this.ui.timestamp = Math.floor(Date.now() / 1000);
      if (this.options.LOG_TYPE === "dev") render(this.ui);
    }, 17);
    this.etaInterval = setInterval(() => {
      this.updateBackfillEta();
      this.logBackfillProgress();
    }, 1000);

    // Codegen must happen before reloadHandlers because handlers depend on `generated/index.ts`.
    this.codegen();

    await Promise.all([
      this.cacheStore.migrate(),
      this.reloadHandlers(),
      this.resetEntityStore(),
    ]);

    await this.setupPlugins();
  }

  async reloadHandlers() {
    if (this.handlerQueue) {
      this.handlerQueue.kill();
      delete this.handlerQueue;
      this.isAddingLogs = false;
    }

    const handlers = await readHandlers({ ponder: this });
    if (!handlers) return;

    const handlerQueue = createHandlerQueue({
      ponder: this,
      handlers: handlers,
    });
    if (!handlerQueue) return;

    this.handlerQueue = handlerQueue;
  }

  loadSchema() {
    const graphqlSchema = readGraphqlSchema({ ponder: this });
    // It's possible for `readGraphqlSchema` to emit a dev_error and return null.
    if (!graphqlSchema) return;
    this.schema = buildSchema(graphqlSchema);
  }

  async resetEntityStore() {
    await this.entityStore.migrate(this.schema);
  }

  async reload() {
    this.logsAddedToTimestamp = 0;
    this.ui.handlersTotal = 0;
    this.ui.handlersCurrent = 0;
    this.ui.handlerError = null;

    this.codegen();

    await Promise.all([this.resetEntityStore(), this.reloadHandlers()]);

    this.reloadPlugins();
    this.emit("backfill_newLogs");
  }

  watch() {
    const watchFiles = [
      this.options.PONDER_CONFIG_FILE_PATH,
      this.options.SCHEMA_FILE_PATH,
      this.options.SRC_DIR_PATH,
      ...this.sources
        .map((s) => s.abiFilePath)
        .filter((p): p is string => typeof p === "string"),
    ];

    const watchers = watchFiles.map((fileOrDirName) =>
      watch(fileOrDirName, { recursive: true }, (_, fileName) => {
        const fullPath =
          path.basename(fileOrDirName) === fileName
            ? fileOrDirName
            : path.join(fileOrDirName, fileName);

        if (fullPath === this.options.PONDER_CONFIG_FILE_PATH) {
          this.logMessage(
            MessageKind.ERROR,
            "detected change in ponder.ts. " + pico.bold("Restart the server.")
          );
          this.kill();
          return;
        }

        if (isFileChanged(fullPath)) {
          this.logMessage(
            MessageKind.EVENT,
            "detected change in " + pico.bold(fileName)
          );
          this.reload();
        }
      })
    );

    this.killWatchers = () => {
      watchers.forEach((w) => w.close());
    };
  }

  // --------------------------- INDEXER --------------------------- //

  async getLatestBlockNumbers() {
    const frontfillSources = this.sources.filter(
      (source) => source.endBlock === undefined && source.isIndexed
    );

    const frontfillNetworkSet = new Set<Network>();
    frontfillSources.forEach((source) =>
      frontfillNetworkSet.add(source.network)
    );

    await Promise.all(
      Array.from(frontfillNetworkSet).map(async (network) => {
        const latestBlockNumber = await getLatestBlockForNetwork({
          network,
          ponder: this,
        });
        this.frontfillNetworks.push({ network, latestBlockNumber });
      })
    );

    frontfillSources.forEach((source) => {
      const frontfillNetwork = this.frontfillNetworks.find(
        (n) => n.network.name === source.network.name
      );
      if (!frontfillNetwork) {
        throw new Error(`Frontfill network not found: ${source.network.name}`);
      }
      source.endBlock = frontfillNetwork.latestBlockNumber;
    });
  }

  frontfill() {
    const { killFrontfillQueues } = startFrontfill({
      ponder: this,
    });
    this.killFrontfillQueues = killFrontfillQueues;
  }

  async backfill() {
    const startHrt = startBenchmark();

    const { killBackfillQueues, drainBackfillQueues } = await startBackfill({
      ponder: this,
    });
    this.killBackfillQueues = killBackfillQueues;

    await drainBackfillQueues();
    const duration = formatEta(endBenchmark(startHrt));

    if (this.options.LOG_TYPE === "start") {
      this.logMessage(MessageKind.BACKFILL, `backfill complete (${duration})`);
    }

    this.ui = {
      ...this.ui,
      isBackfillComplete: true,
      backfillDuration: duration,
    };

    // If there were no backfill logs, trigger this event manually once here to
    // process cached logs.
    this.emit("backfill_newLogs");
  }

  async addNewLogs() {
    if (!this.handlerQueue || this.isAddingLogs) return;
    this.isAddingLogs = true;

    const { hasNewLogs, toTimestamp, logs } = await getLogs({
      ponder: this,
      fromTimestamp: this.logsAddedToTimestamp,
    });

    if (!hasNewLogs) {
      this.isAddingLogs = false;
      return;
    }

    for (const log of logs) {
      this.handlerQueue.push(log);
    }

    this.ui.handlersTotal += logs.length;
    this.logsAddedToTimestamp = toTimestamp;
    this.ui.handlersToTimestamp = toTimestamp;
    this.isAddingLogs = false;

    if (this.options.LOG_TYPE === "start" && logs.length > 0) {
      this.logMessage(MessageKind.INDEXER, `adding ${logs.length} events`);
    }
  }

  async processLogs() {
    if (!this.handlerQueue) return;

    const logCount = this.handlerQueue.length();

    this.handlerQueue.resume();
    if (!this.handlerQueue.idle()) {
      await this.handlerQueue.drained();
    }
    this.handlerQueue.pause();

    if (this.options.LOG_TYPE === "start" && logCount > 0) {
      this.logMessage(MessageKind.INDEXER, `processed ${logCount} events`);
    }
  }

  // --------------------------- EVENT HANDLERS --------------------------- //

  private dev_error: PonderEvents["dev_error"] = async (e) => {
    if (this.options.LOG_TYPE === "codegen") return;

    this.handlerQueue?.kill();
    this.logMessage(MessageKind.ERROR, e.context);

    // If not the dev server, log the entire error and kill the app.
    if (this.options.LOG_TYPE === "start") {
      if (e.error) logger.error(e.error);
      await this.kill();
      return;
    }

    this.ui = { ...this.ui, handlerError: e };
  };

  private backfill_networkConnected: PonderEvents["backfill_networkConnected"] =
    (e) => {
      this.ui.networks[e.network] = {
        name: e.network,
        blockNumber: e.blockNumber,
        blockTimestamp: e.blockTimestamp,
        blockTxnCount: -1,
        matchedLogCount: -1,
      };
    };

  private backfill_sourceStarted: PonderEvents["backfill_sourceStarted"] = (
    e
  ) => {
    if (this.options.LOG_TYPE === "start") {
      this.logMessage(
        MessageKind.BACKFILL,
        `started backfill for source ${pico.bold(e.source)} (${formatPercentage(
          e.cacheRate
        )} cached)`
      );
    }

    this.ui.stats[e.source].cacheRate = e.cacheRate;
  };

  private backfill_logTasksAdded: PonderEvents["backfill_logTasksAdded"] = (
    e
  ) => {
    this.ui.stats[e.source].logTotal += e.taskCount;
  };
  private backfill_blockTasksAdded: PonderEvents["backfill_blockTasksAdded"] = (
    e
  ) => {
    this.ui.stats[e.source].blockTotal += e.taskCount;
  };

  private backfill_logTaskFailed: PonderEvents["backfill_logTaskFailed"] = (
    e
  ) => {
    logMessage(
      MessageKind.WARNING,
      `log backfill task failed with error: ${e.error.message}`
    );
  };
  private backfill_blockTaskFailed: PonderEvents["backfill_blockTaskFailed"] = (
    e
  ) => {
    logMessage(
      MessageKind.WARNING,
      `block backfill task failed with error: ${e.error.message}`
    );
  };

  private backfill_logTaskDone: PonderEvents["backfill_logTaskDone"] = (e) => {
    if (this.ui.stats[e.source].logCurrent === 0) {
      this.ui.stats[e.source].logStartTimestamp = Date.now();
    }

    this.ui.stats[e.source] = {
      ...this.ui.stats[e.source],
      logCurrent: this.ui.stats[e.source].logCurrent + 1,
      logAvgDuration:
        (Date.now() - this.ui.stats[e.source].logStartTimestamp) /
        this.ui.stats[e.source].logCurrent,
      logAvgBlockCount:
        this.ui.stats[e.source].blockTotal / this.ui.stats[e.source].logCurrent,
    };
  };

  private backfill_blockTaskDone: PonderEvents["backfill_blockTaskDone"] = (
    e
  ) => {
    if (this.ui.stats[e.source].blockCurrent === 0) {
      this.ui.stats[e.source].blockStartTimestamp = Date.now();
    }

    this.ui.stats[e.source] = {
      ...this.ui.stats[e.source],
      blockCurrent: this.ui.stats[e.source].blockCurrent + 1,
      blockAvgDuration:
        (Date.now() - this.ui.stats[e.source].blockStartTimestamp) /
        this.ui.stats[e.source].blockCurrent,
    };
  };

  private backfill_newLogs = async () => {
    await this.addNewLogs();
    await this.processLogs();
  };

  private frontfill_taskFailed: PonderEvents["frontfill_taskFailed"] = (e) => {
    logMessage(
      MessageKind.WARNING,
      `block frontfill task failed with error: ${e.error.message}`
    );
  };

  private frontfill_newLogs: PonderEvents["frontfill_newLogs"] = async (e) => {
    if (this.options.LOG_TYPE === "start" && this.ui.isBackfillComplete) {
      this.logMessage(
        MessageKind.FRONTFILL,
        `${e.network} block ${e.blockNumber} (${e.blockTxnCount} txns, ${e.matchedLogCount} matched events)`
      );
    }
    this.ui.networks[e.network] = {
      name: e.network,
      blockNumber: e.blockNumber,
      blockTimestamp: e.blockTimestamp,
      blockTxnCount: e.blockTxnCount,
      matchedLogCount: e.matchedLogCount,
    };
    await this.addNewLogs();
    await this.processLogs();
  };

  private indexer_taskStarted: PonderEvents["indexer_taskStarted"] = () => {
    this.ui.handlersCurrent += 1;
  };

  private indexer_taskDone: PonderEvents["indexer_taskDone"] = (e) => {
    this.ui.handlersToTimestamp = e.timestamp;
    if (this.options.LOG_TYPE === "dev") render(this.ui);
  };

  // --------------------------- PLUGINS --------------------------- //

  // private buildPlugins(pluginBuilders: PonderPluginBuilder[]) {
  //   return pluginBuilders.map((plugin) => plugin(this));
  // }

  private async setupPlugins() {
    await Promise.all(this.plugins.map(async (p) => await p.setup?.()));
  }

  private async reloadPlugins() {
    await Promise.all(this.plugins.map(async (p) => await p.reload?.()));
  }

  private async teardownPlugins() {
    await Promise.all(this.plugins.map(async (p) => await p.teardown?.()));
  }

  // --------------------------- HELPERS --------------------------- //

  private updateBackfillEta = () => {
    this.sources
      .filter((source) => source.isIndexed)
      .forEach((source) => {
        const stats = this.ui.stats[source.name];

        const logTime =
          (stats.logTotal - stats.logCurrent) * stats.logAvgDuration;

        const blockTime =
          (stats.blockTotal - stats.blockCurrent) * stats.blockAvgDuration;

        const estimatedAdditionalBlocks =
          (stats.logTotal - stats.logCurrent) * stats.logAvgBlockCount;

        const estimatedAdditionalBlockTime =
          estimatedAdditionalBlocks * stats.blockAvgDuration;

        const eta = Math.max(logTime, blockTime + estimatedAdditionalBlockTime);

        this.ui.stats[source.name].eta = Number.isNaN(eta) ? 0 : eta;
      });
  };

  private logBackfillProgress() {
    if (this.options.LOG_TYPE === "start" && !this.ui.isBackfillComplete) {
      this.sources
        .filter((source) => source.isIndexed)
        .forEach((source) => {
          const stat = this.ui.stats[source.name];

          const current = stat.logCurrent + stat.blockCurrent;
          const total = stat.logTotal + stat.blockTotal;
          const isDone = current === total;
          if (isDone) return;
          const etaText =
            stat.logCurrent > 5 && stat.eta > 0
              ? `~${formatEta(stat.eta)}`
              : "not started";

          const countText = `${current}/${total}`;

          this.logMessage(
            MessageKind.BACKFILL,
            `${source.name}: ${`(${etaText + " | " + countText})`}`
          );
        });
    }
  }

  private logMessage = (kind: MessageKind, message: string) => {
    if (!this.options.SILENT) {
      logMessage(kind, message);
    }
  };
}
