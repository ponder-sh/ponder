import path from "node:path";
import process from "node:process";

import { BuildService } from "@/build/service";
import { CodegenService } from "@/codegen/service";
import { buildContracts } from "@/config/contracts";
import { buildDatabase } from "@/config/database";
import { type Factory, buildFactories } from "@/config/factories";
import { type LogFilter, buildLogFilters } from "@/config/logFilters";
import { type Network, buildNetwork } from "@/config/networks";
import { type Options } from "@/config/options";
import { type ResolvedConfig } from "@/config/types";
import { UserErrorService } from "@/errors/service";
import { EventAggregatorService } from "@/event-aggregator/service";
import { PostgresEventStore } from "@/event-store/postgres/store";
import { SqliteEventStore } from "@/event-store/sqlite/store";
import { type EventStore } from "@/event-store/store";
import { HistoricalSyncService } from "@/historical-sync/service";
import { LoggerService } from "@/logs/service";
import { MetricsService } from "@/metrics/service";
import { RealtimeSyncService } from "@/realtime-sync/service";
import { ServerService } from "@/server/service";
import { TelemetryService } from "@/telemetry/service";
import { UiService } from "@/ui/service";
import { EventHandlerService } from "@/user-handlers/service";
import { PostgresUserStore } from "@/user-store/postgres/store";
import { SqliteUserStore } from "@/user-store/sqlite/store";
import { type UserStore } from "@/user-store/store";

export type Common = {
  options: Options;
  logger: LoggerService;
  errors: UserErrorService;
  metrics: MetricsService;
  telemetry: TelemetryService;
};

export class Ponder {
  common: Common;
  logFilters: LogFilter[];

  eventStore: EventStore;
  userStore: UserStore;

  // List of indexing-related services. One per configured network.
  networkSyncServices: {
    network: Network;
    logFilters: LogFilter[];
    factories: Factory[];
    historicalSyncService: HistoricalSyncService;
    realtimeSyncService: RealtimeSyncService;
  }[] = [];

  eventAggregatorService: EventAggregatorService;
  eventHandlerService: EventHandlerService;

  serverService: ServerService;
  buildService: BuildService;
  codegenService: CodegenService;
  uiService: UiService;

  constructor({
    options,
    config,
    eventStore,
    userStore,
  }: {
    options: Options;
    config: ResolvedConfig;
    // These options are only used for testing.
    eventStore?: EventStore;
    userStore?: UserStore;
  }) {
    const logger = new LoggerService({
      level: options.logLevel,
      dir: options.logDir,
    });
    const errors = new UserErrorService();
    const metrics = new MetricsService();
    const telemetry = new TelemetryService({ options });

    const common = { options, logger, errors, metrics, telemetry };
    this.common = common;

    this.common.logger.debug({
      service: "app",
      msg: `Started using config file: ${path.relative(
        this.common.options.rootDir,
        this.common.options.configFile
      )}`,
    });

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

    const networks = config.networks.map((network) =>
      buildNetwork({ network, common })
    );
    const logFilters = buildLogFilters({ options, config });
    this.logFilters = logFilters;
    const contracts = buildContracts({ options, config, networks });
    const factories = buildFactories({ options, config });

    const networksToSync = config.networks
      .map((network) => buildNetwork({ network, common }))
      .filter((network) => {
        const hasEventSources = [...logFilters, ...factories].some(
          (eventSource) => eventSource.network === network.name
        );
        if (!hasEventSources) {
          this.common.logger.warn({
            service: "app",
            msg: `No event sources found (network=${network.name})`,
          });
        }
        return hasEventSources;
      });

    networksToSync.forEach((network) => {
      const logFiltersForNetwork = logFilters.filter(
        (logFilter) => logFilter.network === network.name
      );
      const factoriesForNetwork = factories.filter(
        (logFilter) => logFilter.network === network.name
      );
      this.networkSyncServices.push({
        network,
        logFilters: logFiltersForNetwork,
        factories: factoriesForNetwork,
        historicalSyncService: new HistoricalSyncService({
          common,
          eventStore: this.eventStore,
          network,
          logFilters: logFiltersForNetwork,
          factories: factoriesForNetwork,
        }),
        realtimeSyncService: new RealtimeSyncService({
          common,
          eventStore: this.eventStore,
          network,
          logFilters: logFiltersForNetwork,
          factories,
        }),
      });
    });

    this.eventAggregatorService = new EventAggregatorService({
      common,
      eventStore: this.eventStore,
      networks,
      logFilters,
      factories,
    });

    this.eventHandlerService = new EventHandlerService({
      common,
      eventStore: this.eventStore,
      userStore: this.userStore,
      eventAggregatorService: this.eventAggregatorService,
      contracts,
      logFilters,
      factories,
    });

    this.serverService = new ServerService({
      common,
      userStore: this.userStore,
    });
    this.buildService = new BuildService({
      common,
      logFilters,
      factories,
    });
    this.codegenService = new CodegenService({
      common,
      contracts,
      logFilters,
      factories,
    });
    this.uiService = new UiService({ common, logFilters, factories });
  }

  async setup() {
    this.registerServiceDependencies();

    // Start the HTTP server.
    await this.serverService.start();

    // These files depend only on ponder.config.ts, so can generate once on setup.
    // Note that loadHandlers depends on the index.ts file being present.
    this.codegenService.generateAppFile();

    // Note that these must occur before loadSchema and loadHandlers.
    await this.eventStore.migrateUp();
    await this.buildService.setup();

    // Manually trigger loading schema and handlers. Subsequent loads
    // are triggered by changes to project files (handled in BuildService).
    this.buildService.buildSchema();
    await this.buildService.buildIndexingFunctions();
    await this.buildService.buildConfig();
  }

  async dev() {
    await this.setup();

    this.common.telemetry.record({
      event: "App Started",
      properties: {
        command: "ponder dev",
        logFilterCount: this.logFilters.length,
        databaseKind: this.eventStore.kind,
      },
    });

    await Promise.all(
      this.networkSyncServices.map(
        async ({ historicalSyncService, realtimeSyncService }) => {
          const blockNumbers = await realtimeSyncService.setup();
          await historicalSyncService.setup(blockNumbers);

          historicalSyncService.start();
          realtimeSyncService.start();
        }
      )
    );
  }

  async start() {
    await this.setup();

    this.common.telemetry.record({
      event: "App Started",
      properties: {
        command: "ponder start",
        logFilterCount: this.logFilters.length,
        databaseKind: this.eventStore.kind,
      },
    });

    await Promise.all(
      this.networkSyncServices.map(
        async ({ historicalSyncService, realtimeSyncService }) => {
          const blockNumbers = await realtimeSyncService.setup();
          await historicalSyncService.setup(blockNumbers);

          historicalSyncService.start();
          realtimeSyncService.start();
        }
      )
    );
  }

  async codegen() {
    this.codegenService.generateAppFile();

    const result = this.buildService.buildSchema();
    if (result) {
      const { schema, graphqlSchema } = result;
      this.codegenService.generateAppFile({ schema });
      this.codegenService.generateSchemaFile({ graphqlSchema });
    }

    await this.kill();
  }

  async kill() {
    this.eventAggregatorService.clearListeners();

    this.common.telemetry.record({
      event: "App Killed",
      properties: {
        processDuration: process.uptime(),
      },
    });

    await Promise.all(
      this.networkSyncServices.map(
        async ({ realtimeSyncService, historicalSyncService }) => {
          await realtimeSyncService.kill();
          await historicalSyncService.kill();
        }
      )
    );

    await this.buildService.kill?.();
    this.uiService.kill();
    this.eventHandlerService.kill();
    await this.serverService.kill();
    await this.userStore.teardown();
    await this.common.telemetry.kill();

    await this.eventStore.kill();

    this.common.logger.debug({
      service: "app",
      msg: `Finished shutdown sequence`,
    });
  }

  private registerServiceDependencies() {
    this.buildService.on("newConfig", async () => {
      this.common.logger.fatal({
        service: "build",
        msg: "Detected change in ponder.config.ts",
      });
      await this.kill();
    });

    this.buildService.on("newSchema", async ({ schema, graphqlSchema }) => {
      this.common.errors.hasUserError = false;

      this.codegenService.generateAppFile({ schema });
      this.codegenService.generateSchemaFile({ graphqlSchema });

      this.serverService.reload({ graphqlSchema });

      await this.eventHandlerService.reset({ schema });
      await this.eventHandlerService.processEvents();
    });

    this.buildService.on("newHandlers", async ({ handlers }) => {
      this.common.errors.hasUserError = false;

      await this.eventHandlerService.reset({ handlers });
      await this.eventHandlerService.processEvents();
    });

    this.networkSyncServices.forEach((networkSyncService) => {
      const { chainId } = networkSyncService.network;
      const { historicalSyncService, realtimeSyncService } = networkSyncService;

      historicalSyncService.on("historicalCheckpoint", ({ blockTimestamp }) => {
        this.eventAggregatorService.handleNewHistoricalCheckpoint({
          chainId,
          timestamp: blockTimestamp,
        });
      });

      historicalSyncService.on("syncComplete", () => {
        this.eventAggregatorService.handleHistoricalSyncComplete({
          chainId,
        });
      });

      realtimeSyncService.on("realtimeCheckpoint", ({ blockTimestamp }) => {
        this.eventAggregatorService.handleNewRealtimeCheckpoint({
          chainId,
          timestamp: blockTimestamp,
        });
      });

      realtimeSyncService.on("finalityCheckpoint", ({ blockTimestamp }) => {
        this.eventAggregatorService.handleNewFinalityCheckpoint({
          chainId,
          timestamp: blockTimestamp,
        });
      });

      realtimeSyncService.on(
        "shallowReorg",
        ({ commonAncestorBlockTimestamp }) => {
          this.eventAggregatorService.handleReorg({
            commonAncestorTimestamp: commonAncestorBlockTimestamp,
          });
        }
      );
    });

    this.eventAggregatorService.on("newCheckpoint", async () => {
      await this.eventHandlerService.processEvents();
    });

    this.eventAggregatorService.on(
      "reorg",
      async ({ commonAncestorTimestamp }) => {
        await this.eventHandlerService.handleReorg({ commonAncestorTimestamp });
        await this.eventHandlerService.processEvents();
      }
    );

    this.eventHandlerService.on("eventsProcessed", ({ toTimestamp }) => {
      if (this.serverService.isHistoricalIndexingComplete) return;

      // If a batch of events are processed AND the historical sync is complete AND
      // the new toTimestamp is greater than the historical sync completion timestamp,
      // historical event processing is complete, and the server should begin responding as healthy.
      if (
        this.eventAggregatorService.historicalSyncCompletedAt &&
        toTimestamp >= this.eventAggregatorService.historicalSyncCompletedAt
      ) {
        this.serverService.setIsHistoricalIndexingComplete();
      }
    });
  }
}
