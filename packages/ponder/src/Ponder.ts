import { Table } from "console-table-printer";
import EventEmitter from "node:events";
import { mkdirSync, watch } from "node:fs";
import path from "node:path";

import type { PonderConfig } from "@/cli/readPonderConfig";
import { generateContextTypes } from "@/codegen/generateContextTypes";
import { generateContractTypes } from "@/codegen/generateContractTypes";
import { generateEntityTypes } from "@/codegen/generateEntityTypes";
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

export class Ponder extends EventEmitter {
  sources: EvmSource[];
  networks: Network[];

  database: PonderDatabase;
  cacheStore: CacheStore;
  entityStore: EntityStore;

  schema?: PonderSchema;
  handlerQueue?: HandlerQueue;
  latestProcessedTimestamp: number;

  // Hot reloading
  watchFiles: string[];

  // Plugins
  plugins: ResolvedPonderPlugin[];
  logger: PonderLogger;
  options: PonderOptions;

  // Interface
  interfaceState: InterfaceState;

  // Backfill/handlers stats
  backfillSourcesStarted: number;
  tableRequestPlan: Table;
  tableResults: Table;
  tableContractCalls: Table;
  // progressBarSync: cliProgress.SingleBar;
  // progressBarHandlers: cliProgress.SingleBar;

  constructor(config: PonderConfig) {
    super();

    setInterval(() => {
      this.emit("render");
    }, 200);

    this.database = buildDb(config);
    this.cacheStore = buildCacheStore(this.database);
    this.entityStore = buildEntityStore(this.database);

    this.logger = logger;
    this.options = OPTIONS;

    const { networks } = buildNetworks({
      config,
      cacheStore: this.cacheStore,
    });
    this.networks = networks;

    const { sources } = buildSources({ config, networks });
    this.sources = sources;

    this.plugins = config.plugins || [];
    this.watchFiles = [
      OPTIONS.SCHEMA_FILE_PATH,
      OPTIONS.HANDLERS_DIR_PATH,
      ...sources.map((s) => s.abiFilePath),
    ];

    this.latestProcessedTimestamp = 0;

    this.interfaceState = initialInterfaceState;

    this.on("newBackfillLogs", this.handleNewLogs);
    this.on("backfillComplete", this.handleNewLogs);
    this.on("newFrontfillLogs", this.handleNewFrontfillLogs);

    this.on("render", this.handleRender);

    this.on("backfillTasksAdded", this.handleBackfillTasksAdded);
    this.on("backfillTaskCompleted", this.handleBackfillTaskCompleted);

    this.backfillSourcesStarted = 0;
    this.tableRequestPlan = new Table();
    this.tableResults = new Table();
    this.tableContractCalls = new Table();
  }

  async start() {
    this.setup();

    await this.reloadSchema();
    this.codegen();
    await this.reloadHandlers();

    await this.setupPlugins();

    await this.backfill();
    this.runHandlers();
  }

  async dev() {
    this.setup();

    await this.reloadSchema();
    this.codegen();
    await this.reloadHandlers();

    this.setupPlugins();

    this.backfill();
    this.runHandlers();
  }

  setup() {
    this.handleRender();

    mkdirSync(path.join(OPTIONS.GENERATED_DIR_PATH), { recursive: true });
    mkdirSync(path.join(OPTIONS.PONDER_DIR_PATH), { recursive: true });
  }

  codegen() {
    generateContractTypes(this.sources);
    generateHandlerTypes(this.sources);
    generateContextTypes(this.sources, this.schema);
    if (this.schema) generateEntityTypes(this.schema);
  }

  async reloadSchema() {
    const userSchema = readSchema();
    this.schema = buildPonderSchema(userSchema);
  }

  async reloadHandlers() {
    if (this.handlerQueue) {
      this.handlerQueue.kill();
      // Unsure if this is necessary after killing it.
      if (!this.handlerQueue.idle()) {
        await this.handlerQueue.drained();
      }
    }

    const handlers = await readHandlers();

    this.handlerQueue = createHandlerQueue({
      ponder: this,
      handlers: handlers,
    });
  }

  async backfill() {
    this.networks.forEach((network) => {
      if (network.rpcUrl === undefined || network.rpcUrl === "") {
        this.emit(
          "backfillError",
          `Invalid or missing RPC URL for network: ${network.name}`
        );
      }
    });

    await this.cacheStore.migrate();

    this.interfaceState = {
      ...this.interfaceState,
      backfillStartTimestamp: Math.floor(Date.now() / 1000),
    };

    const { latestBlockNumberByNetwork, resumeLiveBlockQueues } =
      await startFrontfill({ ponder: this });

    const { duration } = await startBackfill({
      ponder: this,
      latestBlockNumberByNetwork,
    });

    this.emit("backfillComplete");
    this.interfaceState = {
      ...this.interfaceState,
      isBackfillComplete: true,
      backfillDuration: duration,
    };

    resumeLiveBlockQueues();
  }

  async runHandlers() {
    if (!this.schema) {
      console.error(`Cannot run handlers before building schema`);
      return;
    }

    await this.entityStore.migrate(this.schema);
    this.latestProcessedTimestamp = 0;

    this.handleNewLogs();
  }

  // This reload method is not working - can be triggered multiple times
  // leading to multiple backfills happening at the same time.
  async reload() {
    await this.reloadSchema();
    this.codegen();
    await this.reloadHandlers();
    await this.reloadPlugins();

    this.runHandlers();
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
      // this.emit("updateInterfaceState", {
      //   handlersStatus: HandlersStatus.SOURCE_NOT_READY,
      // });
      this.interfaceState = {
        ...this.interfaceState,
        handlersStatus: HandlersStatus.SOURCE_NOT_READY,
      };
      return;
    }

    const minimumCachedToTimestamp = Math.min(...cachedToTimestamps);

    // If the minimum cached timestamp across all sources is less than the
    // latest processed timestamp, we can't process any new logs.
    if (minimumCachedToTimestamp <= this.latestProcessedTimestamp) {
      // this.emit("updateInterfaceState", {
      //   handlersStatus: HandlersStatus.UP_TO_DATE,
      // });
      this.interfaceState = {
        ...this.interfaceState,
        handlersStatus: HandlersStatus.UP_TO_DATE,
      };
      return;
    }

    // NOTE: cacheStore.getLogs is exclusive to the left and inclusive to the right.
    // This is fine because this.latestProcessedTimestamp starts at zero.
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

    logger.debug(
      `Pushing ${sortedLogs.length} logs to the queue [${this.latestProcessedTimestamp}, ${minimumCachedToTimestamp})`
    );

    for (const log of sortedLogs) {
      this.handlerQueue.push({ log });
    }

    this.latestProcessedTimestamp = minimumCachedToTimestamp;
  }

  handleBackfillTasksAdded(taskCount: number) {
    this.interfaceState.backfillTaskTotal += taskCount;
    this.interfaceState.backfillEta = Math.round(
      ((Math.floor(Date.now() / 1000) -
        this.interfaceState.backfillStartTimestamp) /
        this.interfaceState.backfillTaskCurrent) *
        this.interfaceState.backfillTaskTotal
    );
  }

  handleBackfillTaskCompleted() {
    this.interfaceState.backfillTaskCurrent += 1;
    this.interfaceState.backfillEta = Math.round(
      ((Math.floor(Date.now() / 1000) -
        this.interfaceState.backfillStartTimestamp) /
        this.interfaceState.backfillTaskCurrent) *
        this.interfaceState.backfillTaskTotal
    );
  }

  handleNewFrontfillLogs({
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
    this.emit("render");
  }

  handleRender() {
    renderApp(this.interfaceState);
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
