import { watch } from "node:fs";
import path from "node:path";
import pico from "picocolors";

import { PonderCliOptions } from "@/bin/ponder";
import { generateContractTypes } from "@/codegen/generateContractTypes";
import { generateHandlerTypes } from "@/codegen/generateHandlerTypes";
import { EventEmitter } from "@/common/EventEmitter";
import { logger, PonderLogger } from "@/common/logger";
import { buildOptions, PonderOptions } from "@/common/options";
import { PonderConfig, readPonderConfig } from "@/common/readPonderConfig";
import { endBenchmark, formatEta, startBenchmark } from "@/common/utils";
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
import type { ResolvedPonderPlugin } from "@/plugin";
import { buildPonderSchema } from "@/schema/buildPonderSchema";
import { readSchema } from "@/schema/readSchema";
import type { PonderSchema } from "@/schema/types";
import { buildSources } from "@/sources/buildSources";
import type { EvmSource } from "@/sources/evm";
import { getUiState, HandlersStatus, render, UiState } from "@/ui/app";

type Events = {
  config_error: (arg: { error: string }) => void;

  backfill_networkConnected: (arg: {
    network: string;
    blockNumber: number;
    blockTimestamp: number;
  }) => void;
  backfill_newLogs: () => void;
  backfill_tasksAdded: (arg: { taskCount: number }) => void;
  backfill_logTaskDone: (arg: { source: string }) => void;
  backfill_blockTaskDone: (arg: { source: string }) => void;

  frontfill_newLogs: (arg: {
    network: string;
    blockNumber: number;
    blockTimestamp: number;
    blockTxnCount: number;
    matchedLogCount: number;
  }) => void;

  indexer_taskStarted: () => void;
  indexer_taskError: (arg: { error: Error }) => void;
};

export class Ponder extends EventEmitter<Events> {
  config: PonderConfig;

  sources: EvmSource[];
  networks: Network[];

  database: PonderDatabase;
  cacheStore: CacheStore;
  entityStore: EntityStore;

  schema: PonderSchema;
  handlerQueue?: HandlerQueue;
  logsProcessedToTimestamp: number;
  isHandlingLogs: boolean;

  // Hot reloading
  watchFiles: string[];
  killFrontfillQueues?: () => void;
  killBackfillQueues?: () => void;
  killWatchers?: () => void;

  // Plugins
  plugins: ResolvedPonderPlugin[];
  logger: PonderLogger;
  options: PonderOptions;

  // Interface
  renderInterval?: NodeJS.Timer;
  ui: UiState;

  constructor(cliOptions: PonderCliOptions) {
    super();

    this.on("config_error", this.config_error);

    this.on("backfill_networkConnected", this.backfill_networkConnected);
    this.on("backfill_newLogs", this.backfill_newLogs);
    this.on("backfill_tasksAdded", this.backfill_tasksAdded);
    this.on("backfill_logTaskDone", this.backfill_logTaskDone);
    this.on("backfill_blockTaskDone", this.backfill_blockTaskDone);

    this.on("frontfill_newLogs", this.frontfill_newLogs);

    this.on("indexer_taskStarted", this.indexer_taskStarted);
    this.on("indexer_taskError", this.indexer_taskError);

    this.options = buildOptions(cliOptions);

    this.logsProcessedToTimestamp = 0;
    this.isHandlingLogs = false;
    this.ui = getUiState(this.options);

    this.config = readPonderConfig(this.options.PONDER_CONFIG_FILE_PATH);

    this.database = buildDb({ ponder: this });
    this.cacheStore = buildCacheStore({ ponder: this });
    this.entityStore = buildEntityStore({ ponder: this });

    this.logger = logger;

    const { networks } = buildNetworks({ ponder: this });
    this.networks = networks;

    const { sources } = buildSources({ ponder: this });
    this.sources = sources;

    const userSchema = readSchema({ ponder: this });
    this.schema = buildPonderSchema(userSchema);

    this.plugins = this.config.plugins || [];
    this.watchFiles = [
      this.options.SCHEMA_FILE_PATH,
      this.options.HANDLERS_DIR_PATH,
      ...sources
        .map((s) => s.abiFilePath)
        .filter((p): p is string => typeof p === "string"),
    ];
  }

  // --------------------------- PUBLIC METHODS --------------------------- //

  async start() {
    this.ui.isProd = true;
    await this.setup();

    this.setupPlugins();

    await this.backfill();
    this.handleNewLogs();
  }

  async dev() {
    await this.setup();
    this.watch();

    this.codegen();
    this.setupPlugins();

    this.backfill();
    this.handleNewLogs();
  }

  codegen() {
    generateContractTypes({ ponder: this });
    generateHandlerTypes({ ponder: this });
  }

  kill() {
    clearInterval(this.renderInterval);
    this.handlerQueue?.kill();
    this.killFrontfillQueues?.();
    this.killBackfillQueues?.();
    this.killWatchers?.();
    this.teardownPlugins();
  }

  async reloadSchema() {
    const userSchema = readSchema({ ponder: this });
    this.schema = buildPonderSchema(userSchema);
    await this.entityStore.migrate(this.schema);
  }

  // --------------------------- INTERNAL METHODS --------------------------- //

  async setup() {
    this.renderInterval = setInterval(() => {
      this.ui.timestamp = Math.floor(Date.now() / 1000);
      render(this.ui);
    }, 1000);

    await Promise.all([
      this.cacheStore.migrate(),
      this.entityStore.migrate(this.schema),
      this.reloadHandlers(),
    ]);

    // If there is a config error, display the error and exit the process.
    // Eventually, it might make sense to support hot reloading for ponder.config.js.
    if (this.ui.configError) {
      process.exit(1);
    }
  }

  async reloadHandlers() {
    if (this.handlerQueue) {
      this.handlerQueue.kill();
      delete this.handlerQueue;
      this.isHandlingLogs = false;
    }

    const handlers = await readHandlers({ ponder: this });

    if (handlers) {
      this.handlerQueue = createHandlerQueue({
        ponder: this,
        handlers: handlers,
      });
    }
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
    const watchers = this.watchFiles.map((fileOrDirName) =>
      watch(fileOrDirName, { recursive: true }, (_, fileName) => {
        const fullPath =
          path.basename(fileOrDirName) === fileName
            ? fileOrDirName
            : path.join(fileOrDirName, fileName);

        if (isFileChanged(fullPath)) {
          logger.info("");
          logger.info(
            pico.magenta(`Detected change in: `) + pico.bold(`${fileName}`)
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
    this.ui = {
      ...this.ui,
      backfillStartTimestamp: Math.floor(Date.now() / 1000),
    };
    render(this.ui);

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

    if (this.ui.isProd) {
      logger.info(`Backfill completed in ${duration}`);
    }

    this.ui = {
      ...this.ui,
      isBackfillComplete: true,
      backfillDuration: duration,
    };
    render(this.ui);

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
    render(this.ui);

    this.handlerQueue.push(logs);
    await this.handlerQueue.process();

    this.logsProcessedToTimestamp = toTimestamp;
    this.isHandlingLogs = false;
  }

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

  // --------------------------- EVENT HANDLERS --------------------------- //

  private config_error: Events["config_error"] = (e) => {
    this.ui = {
      ...this.ui,
      configError: e.error,
    };
    render(this.ui);
  };

  private backfill_networkConnected: Events["backfill_networkConnected"] = (
    e
  ) => {
    this.ui.networks[e.network] = {
      name: e.network,
      blockNumber: e.blockNumber,
      blockTimestamp: e.blockTimestamp,
      blockTxnCount: -1,
      matchedLogCount: -1,
    };
  };

  private backfill_newLogs = () => this.handleNewLogs();

  private backfill_tasksAdded: Events["backfill_tasksAdded"] = (e) => {
    this.ui.backfillTaskTotal += e.taskCount;
  };

  private backfill_logTaskDone: Events["backfill_logTaskDone"] = () => {};

  private backfill_blockTaskDone: Events["backfill_blockTaskDone"] = () => {};

  private frontfill_newLogs: Events["frontfill_newLogs"] = (e) => {
    this.handleNewLogs();
    this.ui.networks[e.network] = {
      name: e.network,
      blockNumber: e.blockNumber,
      blockTimestamp: e.blockTimestamp,
      blockTxnCount: e.blockTxnCount,
      matchedLogCount: e.matchedLogCount,
    };
    render(this.ui);
  };

  private indexer_taskStarted = () => {
    this.ui.handlersCurrent += 1;
    this.ui.handlersStatus =
      this.ui.handlersCurrent === this.ui.handlersTotal
        ? HandlersStatus.UP_TO_LATEST
        : HandlersStatus.IN_PROGRESS;
    render(this.ui);
  };

  private indexer_taskError: Events["indexer_taskError"] = (e) => {
    logger.info("");
    logger.info(
      pico.red(`Handler error: `) +
        pico.bold(`${e.error.name}: ${e.error.message}`)
    );
    this.handlerQueue?.kill();

    this.ui = {
      ...this.ui,
      handlerError: e.error,
    };
    render(this.ui);
  };

  // --------------------------- HELPERS --------------------------- //

  // private logBackfillProgress() {
  //   if (this.ui.isProd && this.ui.backfillTaskCurrent % 50 === 0) {
  //     logger.info(
  //       `${this.ui.backfillTaskCurrent}/${
  //         this.ui.backfillTaskTotal
  //       } backfill tasks complete, ~${formatEta(
  //         1000 // this.ui.backfillEta.eta
  //       )} remaining`
  //     );
  //   }
  // }
}
