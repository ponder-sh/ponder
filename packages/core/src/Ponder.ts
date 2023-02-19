import chokidar from "chokidar";
import path from "node:path";
import pico from "picocolors";

import { generateApp } from "@/codegen/generateApp";
import { generateAppType } from "@/codegen/generateAppType";
import { generateContractTypes } from "@/codegen/generateContractTypes";
import { logger, logMessage, MessageKind, PonderLogger } from "@/common/logger";
import type { PonderOptions } from "@/common/options";
import {
  endBenchmark,
  formatEta,
  formatPercentage,
  isFileChanged,
  startBenchmark,
} from "@/common/utils";
import type { ResolvedPonderConfig } from "@/config/buildPonderConfig";
import { buildContracts, Contract } from "@/config/contracts";
import type { Network } from "@/config/networks";
import { buildNetworks } from "@/config/networks";
import { buildCacheStore, CacheStore } from "@/db/cache/cacheStore";
import { buildDb, PonderDatabase } from "@/db/db";
import { buildEntityStore, EntityStore } from "@/db/entity/entityStore";
import { createHandlerQueue, HandlerQueue } from "@/handlers/handlerQueue";
import { Handlers, readHandlers } from "@/handlers/readHandlers";
import { getLatestBlockForNetwork } from "@/indexer/tasks/getLatestBlockForNetwork";
import { getLogs } from "@/indexer/tasks/getLogs";
import { startBackfill } from "@/indexer/tasks/startBackfill";
import { startFrontfill } from "@/indexer/tasks/startFrontfill";
import { buildSchema } from "@/schema/buildSchema";
import { readGraphqlSchema } from "@/schema/readGraphqlSchema";
import type { Schema } from "@/schema/types";
import { EventEmitter, PonderEvents, PonderPlugin } from "@/types";
import type { UiState } from "@/ui/app";
import { getUiState, hydrateUi, render, unmount } from "@/ui/app";

export class Ponder extends EventEmitter<PonderEvents> {
  options: PonderOptions;
  config: ResolvedPonderConfig;
  logger: PonderLogger = logger;

  // Config-derived services
  contracts: Contract[];
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
  handlers: Handlers | null = null;
  isAddingLogs = false;
  isProcessingLogs = false;
  isDevError = false;
  logsAddedToTimestamp = 0;
  currentEventBlockTag = 0;

  // Hot reloading
  killFrontfillQueues?: () => void;
  killBackfillQueues?: () => void;
  killWatchers?: () => Promise<void>;

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
    this.on("backfill_contractStarted", this.backfill_contractStarted);
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
    this.contracts = buildContracts({ ponder: this });

    this.plugins = (
      (this.config.plugins as ((ponder: Ponder) => PonderPlugin)[]) || []
    ).map((plugin) => plugin(this));

    hydrateUi({ ui: this.ui, contracts: this.contracts });
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
    await this.teardownPlugins();
    await this.killWatchers?.();
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
    this.isDevError = false;
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
    this.handlers = handlers;
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
    this.ui.handlersHandledTotal = 0;
    this.ui.handlersCurrent = 0;
    this.ui.handlerError = false;

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
      ...this.contracts
        .map((c) => c.abiFilePath)
        .filter((p): p is string => typeof p === "string"),
    ];

    const watcher = chokidar.watch(watchFiles);
    this.killWatchers = async () => {
      await watcher.close();
    };

    watcher.on("change", async (filePath) => {
      if (filePath === this.options.PONDER_CONFIG_FILE_PATH) {
        this.logMessage(
          MessageKind.ERROR,
          "detected change in ponder.config.ts. " +
            pico.bold("Restart the server.")
        );
        this.kill();
        return;
      }

      if (isFileChanged(filePath)) {
        const fileName = path.basename(filePath);

        this.logMessage(
          MessageKind.EVENT,
          "detected change in " + pico.bold(fileName)
        );
        this.reload();
      }
    });
  }

  // --------------------------- INDEXER --------------------------- //

  async getLatestBlockNumbers() {
    const frontfillContracts = this.contracts.filter(
      (contract) => contract.endBlock === undefined && contract.isIndexed
    );

    const frontfillNetworkSet = new Set<Network>();
    frontfillContracts.forEach((contract) =>
      frontfillNetworkSet.add(contract.network)
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

    frontfillContracts.forEach((contract) => {
      const frontfillNetwork = this.frontfillNetworks.find(
        (n) => n.network.name === contract.network.name
      );
      if (!frontfillNetwork) {
        throw new Error(
          `Frontfill network not found: ${contract.network.name}`
        );
      }
      contract.endBlock = frontfillNetwork.latestBlockNumber;
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
    if (!this.handlerQueue || this.isAddingLogs || this.isDevError) return;
    this.isAddingLogs = true;

    const { hasNewLogs, toTimestamp, logs, totalLogCount } = await getLogs({
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

    this.ui.handlersTotal += totalLogCount ?? 0;
    this.ui.handlersHandledTotal += logs.length;
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

    this.isDevError = true;
    this.handlerQueue?.kill();
    this.logMessage(MessageKind.ERROR, e.context + `\n` + e.error?.stack);

    // If prod, kill the app.
    if (this.options.LOG_TYPE === "start") {
      await this.kill();
      return;
    }

    this.ui = { ...this.ui, handlerError: true };
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

  private backfill_contractStarted: PonderEvents["backfill_contractStarted"] = (
    e
  ) => {
    if (this.options.LOG_TYPE === "start") {
      this.logMessage(
        MessageKind.BACKFILL,
        `started backfill for contract ${pico.bold(
          e.contract
        )} (${formatPercentage(e.cacheRate)} cached)`
      );
    }

    this.ui.stats[e.contract].cacheRate = e.cacheRate;
  };

  private backfill_logTasksAdded: PonderEvents["backfill_logTasksAdded"] = (
    e
  ) => {
    this.ui.stats[e.contract].logTotal += e.taskCount;
  };
  private backfill_blockTasksAdded: PonderEvents["backfill_blockTasksAdded"] = (
    e
  ) => {
    this.ui.stats[e.contract].blockTotal += e.taskCount;
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
    if (this.ui.stats[e.contract].logCurrent === 0) {
      this.ui.stats[e.contract].logStartTimestamp = Date.now();
    }

    this.ui.stats[e.contract] = {
      ...this.ui.stats[e.contract],
      logCurrent: this.ui.stats[e.contract].logCurrent + 1,
      logAvgDuration:
        (Date.now() - this.ui.stats[e.contract].logStartTimestamp) /
        this.ui.stats[e.contract].logCurrent,
      logAvgBlockCount:
        this.ui.stats[e.contract].blockTotal /
        this.ui.stats[e.contract].logCurrent,
    };
  };

  private backfill_blockTaskDone: PonderEvents["backfill_blockTaskDone"] = (
    e
  ) => {
    if (this.ui.stats[e.contract].blockCurrent === 0) {
      this.ui.stats[e.contract].blockStartTimestamp = Date.now();
    }

    this.ui.stats[e.contract] = {
      ...this.ui.stats[e.contract],
      blockCurrent: this.ui.stats[e.contract].blockCurrent + 1,
      blockAvgDuration:
        (Date.now() - this.ui.stats[e.contract].blockStartTimestamp) /
        this.ui.stats[e.contract].blockCurrent,
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
    this.contracts
      .filter((contract) => contract.isIndexed)
      .forEach((contract) => {
        const stats = this.ui.stats[contract.name];

        const logTime =
          (stats.logTotal - stats.logCurrent) * stats.logAvgDuration;

        const blockTime =
          (stats.blockTotal - stats.blockCurrent) * stats.blockAvgDuration;

        const estimatedAdditionalBlocks =
          (stats.logTotal - stats.logCurrent) * stats.logAvgBlockCount;

        const estimatedAdditionalBlockTime =
          estimatedAdditionalBlocks * stats.blockAvgDuration;

        const eta = Math.max(logTime, blockTime + estimatedAdditionalBlockTime);

        this.ui.stats[contract.name].eta = Number.isNaN(eta) ? 0 : eta;
      });
  };

  private logBackfillProgress() {
    if (this.options.LOG_TYPE === "start" && !this.ui.isBackfillComplete) {
      this.contracts
        .filter((contract) => contract.isIndexed)
        .forEach((contract) => {
          const stat = this.ui.stats[contract.name];

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
            `${contract.name}: ${`(${etaText + " | " + countText})`}`
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
