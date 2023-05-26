import { CodegenService } from "@/codegen/service";
import { LoggerService, MessageKind } from "@/common/LoggerService";
import { buildContracts } from "@/config/contracts";
import { buildDatabase } from "@/config/database";
import { buildLogFilters, LogFilter } from "@/config/logFilters";
import { buildNetwork, Network } from "@/config/networks";
import { PonderOptions } from "@/config/options";
import { ResolvedPonderConfig } from "@/config/ponderConfig";
import { ErrorService } from "@/errors/ErrorService";
import { EventHandlerService } from "@/handlers/EventHandlerService";
import { ReloadService } from "@/reload/service";
import { ServerService } from "@/server/service";
import { UiService } from "@/ui/service";

import { EventAggregatorService } from "./event-aggregator/service";
import { PostgresEventStore } from "./event-store/postgres/store";
import { SqliteEventStore } from "./event-store/sqlite/store";
import { EventStore } from "./event-store/store";
import { HistoricalSyncService } from "./historical-sync/service";
import { RealtimeSyncService } from "./realtime-sync/service";
import { PostgresUserStore } from "./user-store/postgres/store";
import { SqliteUserStore } from "./user-store/sqlite/store";
import { UserStore } from "./user-store/store";

export type Resources = {
  options: PonderOptions;
  logger: LoggerService;
  errors: ErrorService;
};

export class Ponder {
  resources: Resources;
  logFilters: LogFilter[];

  eventStore: EventStore;
  userStore: UserStore;

  networks: {
    name: string;
    historicalSyncService: HistoricalSyncService;
    realtimeSyncService: RealtimeSyncService;
  }[] = [];

  eventAggregatorService: EventAggregatorService;
  eventHandlerService: EventHandlerService;

  serverService: ServerService;
  reloadService: ReloadService;
  codegenService: CodegenService;
  uiService: UiService;

  constructor({
    options,
    config,
  }: {
    options: PonderOptions;
    config: ResolvedPonderConfig;
  }) {
    const logger = new LoggerService({ options });
    const errors = new ErrorService();

    const resources = { options, logger, errors };
    this.resources = resources;

    const logFilters = buildLogFilters({ options, config });
    this.logFilters = logFilters;
    const contracts = buildContracts({ options, config });
    const database = buildDatabase({ options, config });
    const networks = config.networks.map((network) =>
      buildNetwork({ network })
    );

    this.eventStore =
      database.kind === "sqlite"
        ? new SqliteEventStore({ sqliteDb: database.db })
        : new PostgresEventStore({ pool: database.pool });

    this.userStore =
      database.kind === "sqlite"
        ? new SqliteUserStore({ db: database.db })
        : new PostgresUserStore({ pool: database.pool });

    networks.forEach((network) => {
      const logFiltersForNetwork = logFilters.filter(
        (lf) => lf.network.name === network.name
      );
      this.networks.push({
        name: network.name,
        historicalSyncService: new HistoricalSyncService({
          store: this.eventStore,
          network,
          logFilters: logFiltersForNetwork,
        }),
        realtimeSyncService: new RealtimeSyncService({
          store: this.eventStore,
          network,
          logFilters: logFiltersForNetwork,
        }),
      });
    });

    this.eventAggregatorService = new EventAggregatorService({
      store: this.eventStore,
      networks,
      logFilters,
    });

    this.eventHandlerService = new EventHandlerService({
      resources,
      eventStore: this.eventStore,
      userStore: this.userStore,
      eventAggregatorService: this.eventAggregatorService,
      contracts,
    });

    this.serverService = new ServerService({
      resources,
      userStore: this.userStore,
    });
    this.reloadService = new ReloadService({ resources });
    this.codegenService = new CodegenService({
      resources,
      contracts,
      logFilters,
    });
    this.uiService = new UiService({ resources, logFilters });
  }

  async setup() {
    this.registerServiceDependencies();
    this.registerUiHandlers();

    // If any of the provided networks do not have a valid RPC url,
    // kill the app here. This happens here rather than in the constructor because
    // `ponder codegen` should still be able to if an RPC url is missing. In fact,
    // that is part of the happy path for `create-ponder`.
    const networksMissingRpcUrl: Network[] = [];
    this.logFilters.forEach((logFilter) => {
      if (!logFilter.network.rpcUrl) {
        networksMissingRpcUrl.push(logFilter.network);
      }
    });
    if (networksMissingRpcUrl.length > 0) {
      return new Error(
        `missing RPC URL for networks (${networksMissingRpcUrl.map(
          (n) => `"${n.name}"`
        )}). Did you forget to add an RPC URL in .env.local?`
      );
    }

    // Start the HTTP server.
    this.serverService.start();

    // These files depend only on ponder.config.ts, so can generate once on setup.
    // Note that loadHandlers depends on the index.ts file being present.
    this.codegenService.generateAppFile();

    // Note that this must occur before loadSchema and loadHandlers.
    await this.eventStore.migrateUp();

    // Manually trigger loading schema and handlers. Subsequent loads
    // are triggered by changes to project files (handled in ReloadService).
    this.reloadService.loadSchema();
    await this.reloadService.loadHandlers();
  }

  async dev() {
    const setupError = await this.setup();
    if (setupError) {
      this.resources.logger.logMessage(MessageKind.ERROR, setupError.message);
      return await this.kill();
    }

    await Promise.all(
      this.networks.map(async (network) => {
        const { historicalSyncService, realtimeSyncService } = network;

        const { finalizedBlockNumber } = await realtimeSyncService.setup();
        await historicalSyncService.setup({ finalizedBlockNumber });

        historicalSyncService.start();
        realtimeSyncService.start();
      })
    );

    this.reloadService.watch();
  }

  async start() {
    const setupError = await this.setup();
    if (setupError) {
      this.resources.logger.logMessage(MessageKind.ERROR, setupError.message);
      return await this.kill();
    }

    await Promise.all(
      this.networks.map(async (network) => {
        const { historicalSyncService, realtimeSyncService } = network;

        const { finalizedBlockNumber } = await realtimeSyncService.setup();
        await historicalSyncService.setup({ finalizedBlockNumber });

        historicalSyncService.start();
        realtimeSyncService.start();
      })
    );
  }

  async codegen() {
    this.codegenService.generateAppFile();

    const result = this.reloadService.loadSchema();
    if (result) {
      const { schema, graphqlSchema } = result;
      this.codegenService.generateAppFile({ schema });
      this.codegenService.generateSchemaFile({ graphqlSchema });
    }

    await this.kill();
  }

  async kill() {
    this.eventAggregatorService.clearListeners();

    await Promise.all(
      this.networks.map(async (network) => {
        await network.realtimeSyncService.kill();
        await network.historicalSyncService.kill();
      })
    );

    await this.reloadService.kill?.();
    this.uiService.kill();
    this.eventHandlerService.killQueue();
    await this.serverService.teardown();
    await this.userStore.teardown();
  }

  private registerServiceDependencies() {
    this.reloadService.on("ponderConfigChanged", async () => {
      await this.kill();
    });

    this.reloadService.on("newSchema", async ({ schema, graphqlSchema }) => {
      this.codegenService.generateAppFile({ schema });
      this.codegenService.generateSchemaFile({ graphqlSchema });

      this.serverService.reload({ graphqlSchema });

      await this.userStore.load({ schema });
      this.eventHandlerService.reset({ schema });
    });

    this.reloadService.on("newHandlers", async ({ handlers }) => {
      await this.userStore.reset();
      this.eventHandlerService.reset({ handlers });
    });

    this.networks.forEach((network) => {
      const { historicalSyncService, realtimeSyncService } = network;

      historicalSyncService.on("historicalCheckpoint", ({ timestamp }) => {
        this.eventAggregatorService.handleNewHistoricalCheckpoint({
          chainId: historicalSyncService.network.chainId,
          timestamp,
        });
      });

      historicalSyncService.on("syncComplete", () => {
        this.eventAggregatorService.handleHistoricalSyncComplete({
          chainId: historicalSyncService.network.chainId,
        });
      });

      realtimeSyncService.on("realtimeCheckpoint", ({ timestamp }) => {
        this.eventAggregatorService.handleNewRealtimeCheckpoint({
          chainId: realtimeSyncService.network.chainId,
          timestamp,
        });
      });

      realtimeSyncService.on("finalityCheckpoint", ({ timestamp }) => {
        this.eventAggregatorService.handleNewFinalityCheckpoint({
          chainId: realtimeSyncService.network.chainId,
          timestamp,
        });
      });

      realtimeSyncService.on("shallowReorg", ({ commonAncestorTimestamp }) => {
        this.eventAggregatorService.handleReorg({
          timestamp: commonAncestorTimestamp,
        });
      });
    });

    this.eventAggregatorService.on("newCheckpoint", ({ timestamp }) => {
      this.eventHandlerService.processEvents({ toTimestamp: timestamp });
    });

    // this.backfillService.on("backfillCompleted", async () => {
    //   this.resources.logger.logMessage(
    //     MessageKind.BACKFILL,
    //     "backfill complete"
    //   );
    //   await this.eventHandlerService.processEvents();
    // });

    // this.eventHandlerService.on("eventsProcessed", ({ toTimestamp }) => {
    //   if (this.serverService.isBackfillEventProcessingComplete) return;

    //   // If a batch of events are processed and the new toTimestamp is greater than
    //   // the backfill cutoff timestamp, backfill event processing is complete, and the
    //   // server should begin responding as healthy.
    //   if (toTimestamp >= this.frontfillService.backfillCutoffTimestamp) {
    //     this.serverService.isBackfillEventProcessingComplete = true;
    //     this.resources.logger.logMessage(
    //       MessageKind.INDEXER,
    //       "backfill event processing complete (server now responding as healthy)"
    //     );
    //     // TODO: figure out how to remove this listener from within itself?
    //   }
    // });
  }

  private registerUiHandlers() {
    this.resources.errors.on("handlerError", ({ error }) => {
      this.resources.logger.logMessage(MessageKind.ERROR, error.message);
    });

    // this.frontfillService.on("networkConnected", (e) => {
    //   this.uiService.ui.networks.push(e.network);
    // });

    this.networks.forEach((network) => {
      const {
        historicalSyncService,
        // realtimeSyncService
      } = network;

      historicalSyncService.on("error", ({ error }) => {
        this.resources.logger.logMessage(MessageKind.ERROR, error.message);
      });

      // historicalSyncService.on("syncStarted", () => {
      //   this.logFilters.forEach(({ name }) => {
      //     const metrics = historicalSyncService.metrics.logFilters[name];

      //     this.uiService.ui.stats[name].blockCurrent =
      //       metrics.blockTaskCompletedCount;

      //     this.uiService.ui.stats[name].logCurrent =
      //       metrics.logTaskCompletedCount;
      //   });
      //   // historicalSyncService.metrics.logFilters[]
      //   // this.uiService.ui.stats[name].cacheRate = cacheRate;
      // });
    });

    setInterval(() => {
      this.networks.forEach((network) => {
        const { historicalSyncService, realtimeSyncService } = network;

        if (
          realtimeSyncService.metrics.isConnected &&
          !this.uiService.ui.networks.includes(network.name)
        ) {
          this.uiService.ui.networks.push(network.name);
        }

        this.logFilters.forEach(({ name }) => {
          const metrics = historicalSyncService.metrics.logFilters[name];

          this.uiService.ui.stats[name].blockCurrent =
            metrics.blockTaskCompletedCount;

          this.uiService.ui.stats[name].logCurrent =
            metrics.logTaskCompletedCount;
        });
      });
    }, 17);

    // this.backfillService.on("logFilterStarted", ({ name, cacheRate }) => {
    //   this.resources.logger.logMessage(
    //     MessageKind.BACKFILL,
    //     `started backfill for ${pico.bold(name)} (${formatPercentage(
    //       cacheRate
    //     )} cached)`
    //   );

    //   this.uiService.ui.stats[name].cacheRate = cacheRate;
    // });

    // this.backfillService.on("logTasksAdded", ({ name, count }) => {
    //   this.uiService.ui.stats[name].logTotal += count;
    // });
    // this.backfillService.on("blockTasksAdded", ({ name, count }) => {
    //   this.uiService.ui.stats[name].blockTotal += count;
    // });

    // this.backfillService.on("logTaskCompleted", ({ name }) => {
    //   if (this.uiService.ui.stats[name].logCurrent === 0) {
    //     this.uiService.ui.stats[name].logStartTimestamp = Date.now();
    //   }

    //   this.uiService.ui.stats[name] = {
    //     ...this.uiService.ui.stats[name],
    //     logCurrent: this.uiService.ui.stats[name].logCurrent + 1,
    //     logAvgDuration:
    //       (Date.now() - this.uiService.ui.stats[name].logStartTimestamp) /
    //       this.uiService.ui.stats[name].logCurrent,
    //     logAvgBlockCount:
    //       this.uiService.ui.stats[name].blockTotal /
    //       this.uiService.ui.stats[name].logCurrent,
    //   };
    // });
    // this.backfillService.on("blockTaskCompleted", ({ name }) => {
    //   if (this.uiService.ui.stats[name].blockCurrent === 0) {
    //     this.uiService.ui.stats[name].blockStartTimestamp = Date.now();
    //   }

    //   this.uiService.ui.stats[name] = {
    //     ...this.uiService.ui.stats[name],
    //     blockCurrent: this.uiService.ui.stats[name].blockCurrent + 1,
    //     blockAvgDuration:
    //       (Date.now() - this.uiService.ui.stats[name].blockStartTimestamp) /
    //       this.uiService.ui.stats[name].blockCurrent,
    //   };
    // });
    // this.backfillService.on("backfillCompleted", ({ duration }) => {
    //   this.uiService.ui.isBackfillComplete = true;
    //   this.uiService.ui.backfillDuration = formatEta(duration);
    // });

    // this.frontfillService.on("logTaskCompleted", ({ network, logData }) => {
    //   Object.entries(logData).forEach(([blockNumber, logInfo]) => {
    //     const total = Object.values(logInfo).reduce((sum, a) => sum + a, 0);
    //     this.resources.logger.logMessage(
    //       MessageKind.FRONTFILL,
    //       `${network} @ ${blockNumber} (${total} matched events)`
    //     );
    //   });
    // });

    // this.frontfillService.on("logTaskFailed", ({ network, error }) => {
    //   this.resources.logger.logMessage(
    //     MessageKind.WARNING,
    //     `(${network}) log frontfill task failed with error: ${error.message}`
    //   );
    // });
    // this.frontfillService.on("blockTaskFailed", ({ network, error }) => {
    //   this.resources.logger.logMessage(
    //     MessageKind.WARNING,
    //     `(${network}) block frontfill task failed with error: ${error.message}`
    //   );
    // });

    this.eventHandlerService.on("taskStarted", () => {
      this.uiService.ui.handlersCurrent += 1;
    });
    this.eventHandlerService.on("taskCompleted", ({ timestamp }) => {
      if (timestamp) this.uiService.ui.handlersToTimestamp = timestamp;
      this.uiService.render();
    });

    this.eventHandlerService.on(
      "eventsAdded",
      ({ totalCount, handledCount }) => {
        this.uiService.ui.handlersTotal += totalCount;
        this.uiService.ui.handlersHandledTotal += handledCount;
      }
    );
    this.eventHandlerService.on("eventsProcessed", ({ toTimestamp }) => {
      this.uiService.ui.handlersToTimestamp = toTimestamp;
    });
    this.eventHandlerService.on("eventQueueReset", () => {
      this.uiService.ui.handlersCurrent = 0;
      this.uiService.ui.handlersTotal = 0;
      this.uiService.ui.handlersHandledTotal = 0;
      this.uiService.ui.handlersToTimestamp = 0;
    });

    this.serverService.on("serverStarted", ({ desiredPort, port }) => {
      if (desiredPort !== port) {
        this.resources.logger.logMessage(
          MessageKind.EVENT,
          `port ${desiredPort} unavailable, server listening on port ${port}`
        );
      } else {
        this.resources.logger.logMessage(
          MessageKind.EVENT,
          `server listening on port ${port}`
        );
      }
      this.uiService.ui.port = port;
    });

    this.resources.errors.on("handlerError", () => {
      this.uiService.ui.handlerError = true;
    });
    this.resources.errors.on("handlerErrorCleared", () => {
      this.uiService.ui.handlerError = false;
    });
  }
}
