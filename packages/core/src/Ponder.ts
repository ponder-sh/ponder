import { watch } from "node:fs";
import path from "node:path";
import pico from "picocolors";

import { PonderCliCommand, PonderCliOptions } from "@/bin/ponder";
import { generateContractTypes } from "@/codegen/generateContractTypes";
import { generateHandlerTypes } from "@/codegen/generateHandlerTypes";
import { logger, logMessage, MessageKind, PonderLogger } from "@/common/logger";
import { buildOptions, PonderOptions } from "@/common/options";
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
import { getLogs } from "@/indexer/tasks/getLogs";
import { startBackfill } from "@/indexer/tasks/startBackfill";
import { startFrontfill } from "@/indexer/tasks/startFrontfill";
import type { Network } from "@/networks/base";
import { buildNetworks } from "@/networks/buildNetworks";
import { PonderConfig, readPonderConfig } from "@/readPonderConfig";
import { buildSchema } from "@/schema/buildSchema";
import { readGraphqlSchema } from "@/schema/readGraphqlSchema";
import type { Schema } from "@/schema/types";
import { buildSources } from "@/sources/buildSources";
import type { EvmSource } from "@/sources/evm";
import { EventEmitter, PonderEvents, ResolvedPonderPlugin } from "@/types";
import type { UiState } from "@/ui/app";
import { getUiState, hydrateUi, render, unmount } from "@/ui/app";

export class Ponder extends EventEmitter<PonderEvents> {
  command: PonderCliCommand;
  options: PonderOptions;
  config: PonderConfig;
  logger: PonderLogger = logger;

  // Config-derived services
  sources: EvmSource[];
  networks: Network[];
  database: PonderDatabase;
  cacheStore: CacheStore;
  entityStore: EntityStore;

  //
  schema?: Schema;
  handlerQueue?: HandlerQueue;

  // Handler state
  isHandlingLogs = false;
  logsProcessedToTimestamp = 0;
  currentEventBlockTag = 0;

  // Hot reloading
  killFrontfillQueues?: () => void;
  killBackfillQueues?: () => void;
  killWatchers?: () => void;

  // Plugins
  plugins: ResolvedPonderPlugin[] = [];

  // UI
  ui: UiState;
  renderInterval?: NodeJS.Timer;
  etaInterval?: NodeJS.Timer;

  constructor(cliOptions: PonderCliOptions & { command: PonderCliCommand }) {
    super();
    this.command = cliOptions.command;

    this.on("config_error", this.config_error);
    this.on("dev_error", this.dev_error);

    this.on("backfill_networkConnected", this.backfill_networkConnected);
    this.on("backfill_sourceStarted", this.backfill_sourceStarted);
    this.on("backfill_logTasksAdded", this.backfill_logTasksAdded);
    this.on("backfill_blockTasksAdded", this.backfill_blockTasksAdded);
    this.on("backfill_logTaskDone", this.backfill_logTaskDone);
    this.on("backfill_blockTaskDone", this.backfill_blockTaskDone);
    this.on("backfill_newLogs", this.backfill_newLogs);

    this.on("frontfill_newLogs", this.frontfill_newLogs);

    this.on("indexer_taskStarted", this.indexer_taskStarted);
    this.on("indexer_taskDone", this.indexer_taskDone);

    this.options = buildOptions(cliOptions);

    this.ui = getUiState(this.options);

    this.config = readPonderConfig(this.options.PONDER_CONFIG_FILE_PATH);
    this.plugins = this.config.plugins || [];

    this.database = buildDb({ ponder: this });
    this.cacheStore = buildCacheStore({ ponder: this });
    this.entityStore = buildEntityStore({ ponder: this });

    const { networks } = buildNetworks({ ponder: this });
    this.networks = networks;

    const { sources } = buildSources({ ponder: this });
    this.sources = sources;

    hydrateUi({ ui: this.ui, sources });
  }

  // --------------------------- PUBLIC METHODS --------------------------- //

  async start() {
    await this.setup();
    this.setupPlugins();
    await this.backfill();
  }

  async dev() {
    await this.setup();
    this.watch();
    this.codegen();
    this.setupPlugins();
    this.backfill();
  }

  codegen() {
    generateContractTypes({ ponder: this });
    generateHandlerTypes({ ponder: this });
  }

  kill() {
    unmount();
    clearInterval(this.renderInterval);
    clearInterval(this.etaInterval);
    this.handlerQueue?.kill();
    this.killFrontfillQueues?.();
    this.killBackfillQueues?.();
    this.killWatchers?.();
    this.teardownPlugins();
  }

  // --------------------------- INTERNAL METHODS --------------------------- //

  async setup() {
    this.renderInterval = setInterval(() => {
      this.ui.timestamp = Math.floor(Date.now() / 1000);
      if (this.command === "dev") render(this.ui);
    }, 17);
    this.etaInterval = setInterval(() => {
      this.updateBackfillEta();
      this.logBackfillProgress();
    }, 1000);

    await Promise.all([
      this.cacheStore.migrate(),
      this.reloadHandlers(),
      this.reloadSchema(),
    ]);
  }

  async reloadHandlers() {
    if (this.handlerQueue) {
      this.handlerQueue.kill();
      delete this.handlerQueue;
      this.isHandlingLogs = false;
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

  async reloadSchema() {
    const graphqlSchema = readGraphqlSchema({ ponder: this });
    // It's possible for `readGraphqlSchema` to emit a dev_error and return null.
    if (!graphqlSchema) return;
    this.schema = buildSchema(graphqlSchema);
    await this.entityStore.migrate(this.schema);
  }

  async reload() {
    this.logsProcessedToTimestamp = 0;
    this.ui.handlersTotal = 0;
    this.ui.handlersCurrent = 0;
    this.ui.handlerError = null;

    await Promise.all([this.reloadSchema(), this.reloadHandlers()]);

    this.codegen();
    this.reloadPlugins();
    this.handleNewLogs();
  }

  watch() {
    const watchFiles = [
      this.options.PONDER_CONFIG_FILE_PATH,
      this.options.SCHEMA_FILE_PATH,
      this.options.HANDLERS_DIR_PATH,
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
          this.emit("config_error", {
            context:
              "detected change in ponder.config.js. " +
              pico.bold("Restart the server."),
          });
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

  async backfill() {
    const startHrt = startBenchmark();

    const { blockNumberByNetwork, killFrontfillQueues } = await startFrontfill({
      ponder: this,
    });
    this.killFrontfillQueues = killFrontfillQueues;

    const { killBackfillQueues, drainBackfillQueues } = await startBackfill({
      ponder: this,
      blockNumberByNetwork,
    });
    this.killBackfillQueues = killBackfillQueues;

    await drainBackfillQueues();
    const duration = formatEta(endBenchmark(startHrt));

    if (this.command === "start") {
      this.logMessage(MessageKind.BACKFILL, `backfill complete (${duration})`);
    }

    this.ui = {
      ...this.ui,
      isBackfillComplete: true,
      backfillDuration: duration,
    };

    // If there were no backfill logs, handleNewLogs won't get triggered until the next
    // set of frontfill logs. So, trigger it manually here.
    this.handleNewLogs();
  }

  private async handleNewLogs() {
    if (!this.handlerQueue || this.isHandlingLogs) return;
    this.isHandlingLogs = true;

    const { hasNewLogs, toTimestamp, logs } = await getLogs({
      ponder: this,
      fromTimestamp: this.logsProcessedToTimestamp,
    });

    if (!hasNewLogs) {
      this.isHandlingLogs = false;
      return;
    }

    this.ui.handlersTotal += logs.length;

    this.handlerQueue.push(logs);
    await this.handlerQueue.process();

    this.logsProcessedToTimestamp = toTimestamp;
    this.ui.handlersToTimestamp = toTimestamp;
    this.isHandlingLogs = false;

    if (this.command === "start" && logs.length > 0) {
      this.logMessage(MessageKind.INDEXER, `indexed ${logs.length} events`);
    }
  }

  // --------------------------- EVENT HANDLERS --------------------------- //

  private config_error: PonderEvents["config_error"] = async (e) => {
    if (this.command === "codegen") return;
    this.logMessage(MessageKind.ERROR, e.context);
    if (e.error) logger.error(e.error);
    this.kill();
  };

  private dev_error: PonderEvents["dev_error"] = async (e) => {
    this.handlerQueue?.kill();
    this.logMessage(MessageKind.ERROR, e.context);

    // If not the dev server, log the entire error and kill the app.
    if (this.command === "start") {
      if (e.error) logger.error(e.error);
      this.kill();
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
    if (this.command === "start") {
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

  private backfill_newLogs = () => {
    // this.handleNewLogs();
  };

  private frontfill_newLogs: PonderEvents["frontfill_newLogs"] = (e) => {
    if (this.command === "start" && this.ui.isBackfillComplete) {
      this.logMessage(
        MessageKind.FRONTFILL,
        `${e.network} block ${e.blockNumber} (${e.blockTxnCount} txns, ${e.matchedLogCount} matched events)`
      );
    }
    this.handleNewLogs();
    this.ui.networks[e.network] = {
      name: e.network,
      blockNumber: e.blockNumber,
      blockTimestamp: e.blockTimestamp,
      blockTxnCount: e.blockTxnCount,
      matchedLogCount: e.matchedLogCount,
    };
  };

  private indexer_taskStarted: PonderEvents["indexer_taskStarted"] = () => {
    this.ui.handlersCurrent += 1;
  };

  private indexer_taskDone: PonderEvents["indexer_taskDone"] = (e) => {
    this.ui.handlersToTimestamp = e.timestamp;
    if (this.command === "dev") render(this.ui);
  };

  // --------------------------- PLUGINS --------------------------- //

  private async setupPlugins() {
    for (const plugin of this.plugins) {
      if (!plugin.setup) return;
      await plugin.setup(this);
    }
  }

  private async reloadPlugins() {
    for (const plugin of this.plugins) {
      if (!plugin.reload) return;
      await plugin.reload(this);
    }
  }

  private async teardownPlugins() {
    for (const plugin of this.plugins) {
      if (!plugin.teardown) return;
      plugin.teardown(this);
    }
  }

  // --------------------------- HELPERS --------------------------- //

  private updateBackfillEta = () => {
    for (const source of this.sources) {
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
    }
  };

  private logBackfillProgress() {
    if (this.command === "start" && !this.ui.isBackfillComplete) {
      this.sources.forEach((source) => {
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
    logMessage(kind, message, this.command === "dev");
  };
}
