import path from "node:path";
import process from "node:process";

import { BuildService } from "@/build/service";
import { CodegenService } from "@/codegen/service";
import { type Config } from "@/config/config";
import { buildDatabase } from "@/config/database";
import { type Network, buildNetwork } from "@/config/networks";
import { type Options } from "@/config/options";
import { UserErrorService } from "@/errors/service";
import { EventAggregatorService } from "@/event-aggregator/service";
import { PostgresEventStore } from "@/event-store/postgres/store";
import { SqliteEventStore } from "@/event-store/sqlite/store";
import { type EventStore } from "@/event-store/store";
import { HistoricalSyncService } from "@/historical-sync/service";
import { IndexingService } from "@/indexing/service";
import { LoggerService } from "@/logs/service";
import { MetricsService } from "@/metrics/service";
import { RealtimeSyncService } from "@/realtime-sync/service";
import { ServerService } from "@/server/service";
import { TelemetryService } from "@/telemetry/service";
import { UiService } from "@/ui/service";
import { PostgresUserStore } from "@/user-store/postgres/store";
import { SqliteUserStore } from "@/user-store/sqlite/store";
import { type UserStore } from "@/user-store/store";

import { buildSources, Source } from "./config/sources";

export type Common = {
  options: Options;
  logger: LoggerService;
  errors: UserErrorService;
  metrics: MetricsService;
  telemetry: TelemetryService;
};

export class Ponder {
  common: Common;
  sources: Source[];

  eventStore: EventStore;
  userStore: UserStore;

  // List of indexing-related services. One per configured network.
  networkSyncServices: {
    network: Network;
    sources: Source[];
    historicalSyncService: HistoricalSyncService;
    realtimeSyncService: RealtimeSyncService;
  }[] = [];

  eventAggregatorService: EventAggregatorService;
  indexingService: IndexingService;

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
    config: Config;
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

    const sources = buildSources({ config });
    this.sources = sources;

    const networksToSync = config.networks
      .map((network) => buildNetwork({ network, common }))
      .filter((network) => {
        const hasEventSources = this.sources.some(
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
      const sourcesForNetwork = sources.filter(
        (logSource) => logSource.network === network.name
      );

      this.networkSyncServices.push({
        network,

        sources: sourcesForNetwork,
        historicalSyncService: new HistoricalSyncService({
          common,
          eventStore: this.eventStore,
          network,
          sources: sourcesForNetwork,
        }),
        realtimeSyncService: new RealtimeSyncService({
          common,
          eventStore: this.eventStore,
          network,
          sources: sourcesForNetwork,
        }),
      });
    });

    this.eventAggregatorService = new EventAggregatorService({
      common,
      eventStore: this.eventStore,
      networks,
      sources,
    });

    this.indexingService = new IndexingService({
      common,
      eventStore: this.eventStore,
      userStore: this.userStore,
      eventAggregatorService: this.eventAggregatorService,
      sources,
    });

    this.serverService = new ServerService({
      common,
      userStore: this.userStore,
    });
    this.buildService = new BuildService({
      common,
      sources,
    });
    this.codegenService = new CodegenService({
      common,
      sources,
    });
    this.uiService = new UiService({ common, sources });
  }

  async setup() {
    this.registerServiceDependencies();

    // Start the HTTP server.
    await this.serverService.start();

    // These files depend only on ponder.config.ts, so can generate once on setup.
    // Note that buildIndexingFunctions depends on the index.ts file being present.
    this.codegenService.generateAppFile();

    // Note that this must occur before buildSchema and buildIndexingFunctions.
    await this.eventStore.migrateUp();

    // Manually trigger loading schema and indexing functions. Subsequent loads
    // are triggered by changes to project files (handled in BuildService).
    this.buildService.buildSchema();
    await this.buildService.buildIndexingFunctions();
  }

  async dev() {
    await this.setup();

    this.common.telemetry.record({
      event: "App Started",
      properties: {
        command: "ponder dev",
        logFilterCount: this.sources.length,
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

    this.buildService.watch();
  }

  async start() {
    await this.setup();

    this.common.telemetry.record({
      event: "App Started",
      properties: {
        command: "ponder start",
        logFilterCount: this.sources.length,
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

    await this.buildService.kill();
    this.uiService.kill();
    this.indexingService.kill();
    await this.serverService.kill();
    await this.common.telemetry.kill();

    await this.userStore.kill();
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
      this.codegenService.generateAppFile({ schema });
      this.codegenService.generateSchemaFile({ graphqlSchema });

      this.serverService.reload({ graphqlSchema });

      await this.indexingService.reset({ schema });
      await this.indexingService.processEvents();
    });

    this.buildService.on(
      "newIndexingFunctions",
      async ({ indexingFunctions }) => {
        await this.indexingService.reset({ indexingFunctions });
        await this.indexingService.processEvents();
      }
    );

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
      await this.indexingService.processEvents();
    });

    this.eventAggregatorService.on(
      "reorg",
      async ({ commonAncestorTimestamp }) => {
        await this.indexingService.handleReorg({ commonAncestorTimestamp });
        await this.indexingService.processEvents();
      }
    );

    this.indexingService.on("eventsProcessed", ({ toTimestamp }) => {
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
