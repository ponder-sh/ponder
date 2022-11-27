import EventEmitter from "node:events";
import { watch } from "node:fs";
import path from "node:path";

import type { PonderConfig } from "@/cli/readPonderConfig";
import { generateContractTypes } from "@/codegen/generateContractTypes";
import { generateHandlerTypes } from "@/codegen/generateHandlerTypes";
import { logger, PonderLogger } from "@/common/logger";
import { OPTIONS, PonderOptions } from "@/common/options";
import { isFileChanged } from "@/common/utils";
import { buildCacheStore, CacheStore } from "@/db/cache/cacheStore";
import { buildDb, PonderDatabase } from "@/db/db";
import { buildEntityStore, EntityStore } from "@/db/entity/entityStore";
import { createHandlerQueue, HandlerQueue } from "@/handlers/handlerQueue";
import { readHandlers } from "@/handlers/readHandlers";
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
import {
  HandlersStatus,
  initialInterfaceState,
  InterfaceState,
  renderApp,
} from "@/ui/app";

import { getLogs } from "./indexer/tasks/getLogs";

export class Ponder extends EventEmitter {
  sources: EvmSource[];
  networks: Network[];

  database: PonderDatabase;
  cacheStore: CacheStore;
  entityStore: EntityStore;

  schema?: PonderSchema;
  handlerQueue?: HandlerQueue;
  logsProcessedToTimestamp: number;
  isHandlingLogs: boolean;

  // Hot reloading
  watchFiles: string[];

  // Plugins
  plugins: ResolvedPonderPlugin[];
  logger: PonderLogger;
  options: PonderOptions;

  // Interface
  renderInterval?: NodeJS.Timer;
  interfaceState: InterfaceState;

  constructor(config: PonderConfig) {
    super();

    this.on("newNetworkConnected", this.handleNewNetworkConnected);
    this.on("newBackfillLogs", this.handleNewBackfillLogs);
    this.on("newFrontfillLogs", this.handleNewFrontfillLogs);

    this.on("backfillTasksAdded", this.handleBackfillTasksAdded);
    this.on("backfillTaskCompleted", this.handleBackfillTaskCompleted);

    this.on("handlerTaskStarted", this.handleHandlerTaskStarted);

    this.on("configError", this.handleConfigError);
    this.on("handlerTaskError", this.handleHandlerTaskError);

    this.logsProcessedToTimestamp = 0;
    this.isHandlingLogs = false;
    this.interfaceState = initialInterfaceState;

    this.database = buildDb(config);
    this.cacheStore = buildCacheStore(this.database);
    this.entityStore = buildEntityStore(this.database);

    this.logger = logger;
    this.options = OPTIONS;

    const { networks } = buildNetworks({
      config,
      ponder: this,
    });
    this.networks = networks;

    const { sources } = buildSources({ config, networks });
    this.sources = sources;

    this.plugins = config.plugins || [];
    this.watchFiles = [
      OPTIONS.SCHEMA_FILE_PATH,
      OPTIONS.HANDLERS_DIR_PATH,
      ...sources
        .map((s) => s.abiFilePath)
        .filter((p): p is string => typeof p === "string"),
    ];
  }

  async setup() {
    this.renderInterval = setInterval(() => {
      this.interfaceState.timestamp = Math.floor(Date.now() / 1000);
      renderApp(this.interfaceState);
    }, 1000);

    await this.cacheStore.migrate();
  }

  kill() {
    clearInterval(this.renderInterval);
  }

  async start() {
    this.interfaceState.isProd = true;
    await this.setup();

    await Promise.all([this.loadSchema(), this.loadHandlers()]);

    // If there is a config error, display the error and exit the process.
    // Eventually, it might make sense to support hot reloading for ponder.config.js.
    if (this.interfaceState.configError) {
      process.exit(1);
    }

    this.codegen();
    this.setupPlugins();

    await this.backfill();
  }

  async dev() {
    await this.setup();
    this.watch();

    await Promise.all([this.loadSchema(), this.loadHandlers()]);

    // See comment in start()
    if (this.interfaceState.configError) {
      process.exit(1);
    }

    this.codegen();
    this.setupPlugins();

    this.backfill();
  }

  codegen() {
    generateContractTypes(this.sources);
    if (this.schema) generateHandlerTypes(this.sources, this.schema);
  }

  async loadSchema() {
    const userSchema = readSchema();
    this.schema = buildPonderSchema(userSchema);
    await this.entityStore.migrate(this.schema);
  }

  async loadHandlers() {
    if (this.handlerQueue) {
      logger.debug("Killing old handlerQueue");
      this.handlerQueue.kill();
      // Unsure if this is necessary after killing it.
      if (!this.handlerQueue.idle()) {
        await this.handlerQueue.drained();
      }
      this.isHandlingLogs = false;
    }

    const handlers = await readHandlers();

    this.handlerQueue = createHandlerQueue({
      ponder: this,
      handlers: handlers,
    });
  }

  async reload() {
    await Promise.all([this.loadSchema(), this.loadHandlers()]);

    this.codegen();
    this.reloadPlugins();

    // This drops and creates the entity tables.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await this.entityStore.migrate(this.schema!);
    this.logsProcessedToTimestamp = 0;
    this.interfaceState.handlersTotal = 0;
    this.interfaceState.handlersCurrent = 0;
    this.interfaceState.handlerError = null;

    this.handleNewLogs();
  }

  async backfill() {
    this.interfaceState = {
      ...this.interfaceState,
      backfillStartTimestamp: Math.floor(Date.now() / 1000),
    };
    renderApp(this.interfaceState);

    const { latestBlockNumberByNetwork } = await startFrontfill({
      ponder: this,
    });

    const { duration } = await startBackfill({
      ponder: this,
      latestBlockNumberByNetwork,
    });

    logger.debug(`Backfill completed in ${duration}`);

    this.interfaceState = {
      ...this.interfaceState,
      isBackfillComplete: true,
      backfillDuration: duration,
    };
    renderApp(this.interfaceState);

    // If there were no backfill logs, handleNewLogs won't get triggered until the next
    // set of frontfill logs. So, trigger it manually here.
    this.handleNewLogs();
  }

  async handleNewLogs() {
    if (!this.handlerQueue) {
      console.error(
        `Attempted to handle new block, but handler queue doesnt exist`
      );
      return;
    }

    if (this.isHandlingLogs) return;
    this.isHandlingLogs = true;

    const { hasNewLogs, toTimestamp, logs } = await getLogs({
      ponder: this,
      fromTimestamp: this.logsProcessedToTimestamp,
    });

    if (!hasNewLogs) {
      this.isHandlingLogs = false;
      return;
    }

    this.interfaceState.handlersTotal += logs.length;
    renderApp(this.interfaceState);

    logger.debug(`Adding ${logs.length} to handlerQueue`);

    for (const log of logs) {
      this.handlerQueue.push({ log });
    }

    this.logsProcessedToTimestamp = toTimestamp;
    this.isHandlingLogs = false;
  }

  private handleBackfillTasksAdded(taskCount: number) {
    this.interfaceState.backfillTaskTotal += taskCount;
    this.updateBackfillEta();
    renderApp(this.interfaceState);
  }

  private handleBackfillTaskCompleted() {
    this.interfaceState.backfillTaskCurrent += 1;
    this.updateBackfillEta();
    renderApp(this.interfaceState);
  }

  private updateBackfillEta() {
    const newEta = Math.round(
      ((Math.floor(Date.now() / 1000) -
        this.interfaceState.backfillStartTimestamp) /
        this.interfaceState.backfillTaskCurrent) *
        this.interfaceState.backfillTaskTotal
    );
    if (Number.isFinite(newEta)) this.interfaceState.backfillEta = newEta;
  }

  private handleHandlerTaskStarted() {
    this.interfaceState.handlersCurrent += 1;
    this.interfaceState.handlersStatus =
      this.interfaceState.handlersCurrent === this.interfaceState.handlersTotal
        ? HandlersStatus.UP_TO_DATE
        : HandlersStatus.IN_PROGRESS;
    renderApp(this.interfaceState);
  }

  private handleConfigError(error: string) {
    this.interfaceState = {
      ...this.interfaceState,
      configError: error,
    };
    renderApp(this.interfaceState);
  }

  private handleHandlerTaskError(error: string) {
    this.interfaceState = {
      ...this.interfaceState,
      handlerError: error,
    };
    renderApp(this.interfaceState);
  }

  private handleNewNetworkConnected({
    network,
    blockNumber,
    blockTimestamp,
  }: {
    network: string;
    blockNumber: number;
    blockTimestamp: number;
  }) {
    this.interfaceState.networks[network] = {
      name: network,
      blockNumber: blockNumber,
      blockTimestamp: blockTimestamp,
      blockTxnCount: -1,
      matchedLogCount: -1,
    };
  }

  private handleNewFrontfillLogs({
    network,
    blockNumber,
    blockTimestamp,
    blockTxnCount,
    matchedLogCount,
  }: {
    network: string;
    blockNumber: number;
    blockTimestamp: number;
    blockTxnCount: number;
    matchedLogCount: number;
  }) {
    this.handleNewLogs();
    this.interfaceState.networks[network] = {
      name: network,
      blockNumber: blockNumber,
      blockTimestamp: blockTimestamp,
      blockTxnCount: blockTxnCount,
      matchedLogCount: matchedLogCount,
    };
    renderApp(this.interfaceState);
  }

  private handleNewBackfillLogs() {
    this.handleNewLogs();
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
          logger.info("");

          this.reload();
        } else {
          logger.debug("File content not changed, not reloading");
        }
      });
    });
  }

  async setupPlugins() {
    for (const plugin of this.plugins) {
      if (!plugin.setup) return;
      await plugin.setup(this);
    }
  }

  async reloadPlugins() {
    for (const plugin of this.plugins) {
      if (!plugin.reload) return;
      await plugin.reload(this);
    }
  }
}
