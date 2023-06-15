import pico from "picocolors";

import { CodegenService } from "@/codegen/service";
import { buildContracts } from "@/config/contracts";
import { buildDatabase } from "@/config/database";
import { buildLogFilters, LogFilter } from "@/config/logFilters";
import { type Network, buildNetwork } from "@/config/networks";
import { type PonderOptions } from "@/config/options";
import { type ResolvedPonderConfig } from "@/config/ponderConfig";
import { ErrorService } from "@/errors/ErrorService";
import { EventAggregatorService } from "@/event-aggregator/service";
import { PostgresEventStore } from "@/event-store/postgres/store";
import { SqliteEventStore } from "@/event-store/sqlite/store";
import { type EventStore } from "@/event-store/store";
import { HistoricalSyncService } from "@/historical-sync/service";
import { MetricsService } from "@/metrics/service";
import { RealtimeSyncService } from "@/realtime-sync/service";
import { ReloadService } from "@/reload/service";
import { ServerService } from "@/server/service";
import { UiService } from "@/ui/service";
import { EventHandlerService } from "@/user-handlers/service";
import { PostgresUserStore } from "@/user-store/postgres/store";
import { SqliteUserStore } from "@/user-store/sqlite/store";
import { type UserStore } from "@/user-store/store";
import { formatEta, formatPercentage } from "@/utils/format";
import { LoggerService } from "@/utils/logger";

export type Resources = {
  options: PonderOptions;
  logger: LoggerService;
  errors: ErrorService;
  metrics: MetricsService;
};

export class Ponder {
  resources: Resources;
  logFilters: LogFilter[];

  eventStore: EventStore;
  userStore: UserStore;

  // List of indexing-related services. One per configured network.
  networkSyncServices: {
    network: Network;
    logFilters: LogFilter[];
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
    eventStore,
    userStore,
  }: {
    options: PonderOptions;
    config: ResolvedPonderConfig;
    // These options are only used for testing.
    eventStore?: EventStore;
    userStore?: UserStore;
  }) {
    const logger = new LoggerService({ options });
    const errors = new ErrorService();
    const metrics = new MetricsService();

    const resources = { options, logger, errors, metrics };
    this.resources = resources;

    const logFilters = buildLogFilters({ options, config });
    this.logFilters = logFilters;
    const contracts = buildContracts({ options, config });
    const networks = config.networks.map((network) =>
      buildNetwork({ network })
    );

    const database = buildDatabase({ options, config });
    this.eventStore =
      eventStore ??
      (database.kind === "sqlite"
        ? new SqliteEventStore({ db: database.db })
        : new PostgresEventStore({ pool: database.pool }));

    this.userStore =
      userStore ??
      (database.kind === "sqlite"
        ? new SqliteUserStore({ db: database.db })
        : new PostgresUserStore({ pool: database.pool }));

    networks.forEach((network) => {
      const logFiltersForNetwork = logFilters.filter(
        (logFilter) => logFilter.network === network.name
      );
      this.networkSyncServices.push({
        network,
        logFilters: logFiltersForNetwork,
        historicalSyncService: new HistoricalSyncService({
          eventStore: this.eventStore,
          network,
          logFilters: logFiltersForNetwork,
        }),
        realtimeSyncService: new RealtimeSyncService({
          eventStore: this.eventStore,
          network,
          logFilters: logFiltersForNetwork,
        }),
      });
    });

    this.eventAggregatorService = new EventAggregatorService({
      eventStore: this.eventStore,
      networks,
      logFilters,
    });

    this.eventHandlerService = new EventHandlerService({
      resources,
      eventStore: this.eventStore,
      userStore: this.userStore,
      eventAggregatorService: this.eventAggregatorService,
      contracts,
      logFilters: this.logFilters,
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
    this.networkSyncServices.forEach(({ network }) => {
      if (!network.rpcUrl) {
        networksMissingRpcUrl.push(network);
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
    await this.serverService.start();

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
      this.resources.logger.logMessage("error", setupError.message);
      return await this.kill();
    }

    await Promise.all(
      this.networkSyncServices.map(
        async ({ historicalSyncService, realtimeSyncService }) => {
          const { finalizedBlockNumber } = await realtimeSyncService.setup();
          await historicalSyncService.setup({ finalizedBlockNumber });

          historicalSyncService.start();
          realtimeSyncService.start();
        }
      )
    );

    this.reloadService.watch();
  }

  async start() {
    const setupError = await this.setup();
    if (setupError) {
      this.resources.logger.logMessage("error", setupError.message);
      return await this.kill();
    }

    await Promise.all(
      this.networkSyncServices.map(
        async ({ historicalSyncService, realtimeSyncService }) => {
          const { finalizedBlockNumber } = await realtimeSyncService.setup();
          await historicalSyncService.setup({ finalizedBlockNumber });

          historicalSyncService.start();
          realtimeSyncService.start();
        }
      )
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
      this.networkSyncServices.map(
        async ({ realtimeSyncService, historicalSyncService }) => {
          await realtimeSyncService.kill();
          await historicalSyncService.kill();
        }
      )
    );

    await this.reloadService.kill?.();
    this.uiService.kill();
    this.eventHandlerService.kill();
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

      this.eventHandlerService.reset({ schema });
    });

    this.reloadService.on("newHandlers", async ({ handlers }) => {
      this.eventHandlerService.reset({ handlers });
    });

    this.networkSyncServices.forEach((networkSyncService) => {
      const { network, historicalSyncService, realtimeSyncService } =
        networkSyncService;

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

      // TODO: Decide what to do after a deep reorg.
      realtimeSyncService.on(
        "deepReorg",
        ({ detectedAtBlockNumber, minimumDepth }) => {
          this.resources.logger.logMessage(
            "error",
            `WARNING: Deep reorg detected on ${network.name} at block ${detectedAtBlockNumber} with a minimum depth of ${minimumDepth}`
          );
        }
      );
    });

    this.eventAggregatorService.on("newCheckpoint", ({ timestamp }) => {
      this.eventHandlerService.processEvents({ toTimestamp: timestamp });
    });

    this.eventAggregatorService.on("reorg", ({ commonAncestorTimestamp }) => {
      this.eventHandlerService.handleReorg({ commonAncestorTimestamp });
    });

    this.eventHandlerService.on("eventsProcessed", ({ toTimestamp }) => {
      if (this.serverService.isHistoricalEventProcessingComplete) return;

      // If a batch of events are processed AND the historical sync is complete AND
      // the new toTimestamp is greater than the historical sync completion timestamp,
      // historical event processing is complete, and the server should begin responding as healthy.
      if (
        this.eventAggregatorService.historicalSyncCompletedAt &&
        toTimestamp >= this.eventAggregatorService.historicalSyncCompletedAt
      ) {
        this.serverService.isHistoricalEventProcessingComplete = true;
        this.resources.logger.logMessage(
          "indexer",
          "historical sync complete (server now responding as healthy)"
        );
      }
    });
  }

  private registerUiHandlers() {
    this.resources.errors.on("handlerError", ({ error }) => {
      this.resources.logger.logMessage("error", error.message);
    });

    this.networkSyncServices.forEach((networkSyncService) => {
      const { historicalSyncService, realtimeSyncService, logFilters } =
        networkSyncService;

      historicalSyncService.on("error", ({ error }) => {
        this.resources.logger.logMessage("error", error.message);
      });

      realtimeSyncService.on("error", ({ error }) => {
        this.resources.logger.logMessage("error", error.message);
      });

      historicalSyncService.on("syncStarted", () => {
        logFilters.forEach(({ name }) => {
          this.uiService.ui.stats[name].logStartTimestamp = Date.now();
          this.uiService.ui.stats[name].blockStartTimestamp = Date.now();

          this.resources.logger.logMessage(
            "historical",
            `started historical sync for ${pico.bold(name)} (${formatPercentage(
              historicalSyncService.metrics.logFilters[name].cacheRate
            )} cached)`
          );
        });
      });

      realtimeSyncService.on("finalityCheckpoint", ({ timestamp }) => {
        this.resources.logger.logMessage(
          "realtime",
          `finality checkpoint, timestamp: ${timestamp}`
        );
      });

      realtimeSyncService.on("shallowReorg", ({ commonAncestorTimestamp }) => {
        this.resources.logger.logMessage(
          "realtime",
          `reorg detected, common ancestor timestamp: ${commonAncestorTimestamp}`
        );
      });
    });

    setInterval(() => {
      this.networkSyncServices.forEach((networkSyncService) => {
        const { network, historicalSyncService, realtimeSyncService } =
          networkSyncService;

        if (
          realtimeSyncService.metrics.isConnected &&
          !this.uiService.ui.networks.includes(network.name)
        ) {
          this.uiService.ui.networks.push(network.name);
        }

        this.logFilters.forEach(({ name }) => {
          const historicalMetrics =
            historicalSyncService.metrics.logFilters[name];

          this.uiService.ui.stats[name].cacheRate = historicalMetrics.cacheRate;

          this.uiService.ui.stats[name].blockCurrent =
            historicalMetrics.blockTaskCompletedCount;
          this.uiService.ui.stats[name].blockTotal =
            historicalMetrics.blockTaskTotalCount;

          this.uiService.ui.stats[name].logCurrent =
            historicalMetrics.logTaskCompletedCount;
          this.uiService.ui.stats[name].logTotal =
            historicalMetrics.logTaskTotalCount;
        });
      });

      const isHistoricalSyncComplete = this.networkSyncServices.every(
        (n) => n.historicalSyncService.metrics.isComplete
      );
      this.uiService.ui.isHistoricalSyncComplete = isHistoricalSyncComplete;

      if (isHistoricalSyncComplete) {
        this.uiService.ui.historicalSyncDuration = formatEta(
          Math.max(
            ...this.networkSyncServices.map(
              (n) => n.historicalSyncService.metrics.duration
            )
          )
        );
      }

      this.uiService.ui.handlerError = this.eventHandlerService.metrics.error;
      this.uiService.ui.handlersHandledTotal =
        this.eventHandlerService.metrics.eventsAddedToQueue;
      this.uiService.ui.handlersCurrent =
        this.eventHandlerService.metrics.eventsProcessedFromQueue;
      this.uiService.ui.handlersTotal =
        this.eventHandlerService.metrics.totalMatchedEvents;
      this.uiService.ui.handlersToTimestamp =
        this.eventHandlerService.metrics.latestHandledEventTimestamp;
    }, 17);

    this.eventHandlerService.on("reset", () => {
      this.uiService.ui.handlersCurrent = 0;
      this.uiService.ui.handlersTotal = 0;
      this.uiService.ui.handlersHandledTotal = 0;
      this.uiService.ui.handlersToTimestamp = 0;
    });

    this.eventHandlerService.on("taskCompleted", () => {
      this.uiService.ui.handlerError = this.eventHandlerService.metrics.error;
      this.uiService.ui.handlersHandledTotal =
        this.eventHandlerService.metrics.eventsAddedToQueue;
      this.uiService.ui.handlersCurrent =
        this.eventHandlerService.metrics.eventsProcessedFromQueue;
      this.uiService.ui.handlersTotal =
        this.eventHandlerService.metrics.totalMatchedEvents;
      this.uiService.ui.handlersToTimestamp =
        this.eventHandlerService.metrics.latestHandledEventTimestamp;
      this.uiService.render();
    });

    this.serverService.on("serverStarted", ({ desiredPort, port }) => {
      if (desiredPort !== port) {
        this.resources.logger.logMessage(
          "event",
          `port ${desiredPort} unavailable, server listening on port ${port}`
        );
      } else {
        this.resources.logger.logMessage(
          "event",
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
