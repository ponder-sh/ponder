import path from "node:path";
import process from "node:process";

import type { GraphQLSchema } from "graphql";

import type { IndexingFunctions } from "@/build/functions/functions.js";
import { BuildService } from "@/build/service.js";
import { CodegenService } from "@/codegen/service.js";
import type { Config } from "@/config/config.js";
import { buildDatabase } from "@/config/database.js";
import { type Network } from "@/config/networks.js";
import { type Options } from "@/config/options.js";
import type { Source } from "@/config/sources.js";
import { PostgresIndexingStore } from "@/indexing-store/postgres/store.js";
import { SqliteIndexingStore } from "@/indexing-store/sqlite/store.js";
import { type IndexingStore } from "@/indexing-store/store.js";
import { IndexingService } from "@/indexing/service.js";
import { LoggerService } from "@/logger/service.js";
import { MetricsService } from "@/metrics/service.js";
import type { Schema } from "@/schema/types.js";
import { ServerService } from "@/server/service.js";
import { SyncGateway } from "@/sync-gateway/service.js";
import { HistoricalSyncService } from "@/sync-historical/service.js";
import { RealtimeSyncService } from "@/sync-realtime/service.js";
import { PostgresSyncStore } from "@/sync-store/postgres/store.js";
import { SqliteSyncStore } from "@/sync-store/sqlite/store.js";
import { type SyncStore } from "@/sync-store/store.js";
import { TelemetryService } from "@/telemetry/service.js";
import { UiService } from "@/ui/service.js";

export type Common = {
  options: Options;
  logger: LoggerService;
  metrics: MetricsService;
  telemetry: TelemetryService;
};

export class Ponder {
  common: Common;
  buildService: BuildService;

  // Derived config
  config: Config = undefined!;
  sources: Source[] = undefined!;
  networks: Network[] = undefined!;
  schema: Schema = undefined!;
  graphqlSchema: GraphQLSchema = undefined!;
  indexingFunctions: IndexingFunctions = undefined!;

  // Sync services
  syncStore: SyncStore = undefined!;
  syncServices: {
    network: Network;
    sources: Source[];
    historical: HistoricalSyncService;
    realtime: RealtimeSyncService;
  }[] = undefined!;
  syncGatewayService: SyncGateway = undefined!;

  // Indexing services
  indexingStore: IndexingStore = undefined!;
  indexingService: IndexingService = undefined!;

  // Misc services
  serverService: ServerService = undefined!;
  codegenService: CodegenService = undefined!;
  uiService: UiService = undefined!;

  constructor({ options }: { options: Options }) {
    const logger = new LoggerService({
      level: options.logLevel,
      dir: options.logDir,
    });
    const metrics = new MetricsService();
    const telemetry = new TelemetryService({ options });

    this.common = { options, logger, metrics, telemetry };

    this.buildService = new BuildService({ common: this.common });
  }

  async dev({
    syncStore,
    indexingStore,
  }: {
    // These options are only used for testing.
    syncStore?: SyncStore;
    indexingStore?: IndexingStore;
  } = {}) {
    const success = await this.setupBuildService();
    if (!success) return;

    this.common.telemetry.record({
      event: "App Started",
      properties: {
        command: "ponder dev",
        contractCount: this.sources.length,
        databaseKind: this.config.database?.kind,
      },
    });

    await this.setupCoreServices({ isDev: true, syncStore, indexingStore });

    // If running `ponder dev`, register build service listeners to handle hot reloads.
    this.registerBuildServiceEventListeners();

    await this.startSyncServices();
  }

  async start({
    syncStore,
    indexingStore,
  }: {
    // These options are only used for testing.
    syncStore?: SyncStore;
    indexingStore?: IndexingStore;
  } = {}) {
    const success = await this.setupBuildService();
    if (!success) return;

    this.common.telemetry.record({
      event: "App Started",
      properties: {
        command: "ponder start",
        contractCount: this.sources.length,
        databaseKind: this.config.database?.kind,
      },
    });

    await this.setupCoreServices({ isDev: false, syncStore, indexingStore });
    await this.startSyncServices();
  }

  async serve() {
    const success = await this.setupBuildService();
    if (!success) return;

    this.common.telemetry.record({
      event: "App Started",
      properties: {
        command: "ponder serve",
        databaseKind: this.config.database?.kind,
      },
    });

    const database = buildDatabase({
      common: this.common,
      config: this.config,
    });

    this.indexingStore =
      database.indexing.kind === "sqlite"
        ? new SqliteIndexingStore({
            common: this.common,
            file: database.indexing.file,
          })
        : new PostgresIndexingStore({
            common: this.common,
            pool: database.indexing.pool,
          });

    this.serverService = new ServerService({
      common: this.common,
      indexingStore: this.indexingStore,
    });

    this.serverService.setup({ registerDevRoutes: false });
    await this.serverService.start();

    // TODO: Make this less hacky. This was a quick way to make the schema available
    // to the findUnique and findMany functions without having to change the API.
    this.indexingStore.schema = this.schema;

    this.serverService.reloadGraphqlSchema({
      graphqlSchema: this.graphqlSchema,
    });
  }

  async codegen() {
    const success = await this.setupBuildService();
    if (!success) return;

    this.codegenService.generateGraphqlSchemaFile({
      graphqlSchema: this.graphqlSchema,
    });

    await this.kill();
  }

  private async setupBuildService() {
    this.common.logger.debug({
      service: "app",
      msg: `Started using config file: ${path.relative(
        this.common.options.rootDir,
        this.common.options.configFile,
      )}`,
    });

    // Initialize the Vite server and Vite Node runner.
    await this.buildService.setup();

    // Build and load dependencies so that we can create initial versions of all services.
    // If any are undefined, there was an error in config, schema, or indexing functions.
    // For now, we can just exit. No need to call `this.kill()` because no services are set up.

    const result = await this.buildService.initialLoad();
    if (result.error) {
      this.common.logger.error({
        service: "build",
        error: result.error,
      });
      this.common.logger.fatal({
        service: "app",
        msg: "Failed intial build",
      });
      await this.buildService.kill();
      return false;
    }

    this.config = result.config;
    this.sources = result.sources;
    this.networks = result.networks;
    this.schema = result.schema;
    this.graphqlSchema = result.graphqlSchema;
    this.indexingFunctions = result.indexingFunctions;

    return true;
  }

  private async setupCoreServices({
    isDev,
    syncStore,
    indexingStore,
  }: {
    isDev: boolean;
    // These options are only used for testing.
    syncStore?: SyncStore;
    indexingStore?: IndexingStore;
  }) {
    const database = buildDatabase({
      common: this.common,
      config: this.config,
    });
    this.syncStore =
      syncStore ??
      (database.sync.kind === "sqlite"
        ? new SqliteSyncStore({ common: this.common, file: database.sync.file })
        : new PostgresSyncStore({
            common: this.common,
            pool: database.sync.pool,
          }));
    this.indexingStore =
      indexingStore ??
      (database.indexing.kind === "sqlite"
        ? new SqliteIndexingStore({
            common: this.common,
            file: database.indexing.file,
          })
        : new PostgresIndexingStore({
            common: this.common,
            pool: database.indexing.pool,
          }));

    const networksToSync = this.networks.filter((network) => {
      const hasSources = this.sources.some(
        (source) => source.networkName === network.name,
      );
      if (!hasSources) {
        this.common.logger.warn({
          service: "app",
          msg: `No contracts found (network=${network.name})`,
        });
      }
      return hasSources;
    });

    this.syncServices = networksToSync.map((network) => {
      const sourcesForNetwork = this.sources.filter(
        (source) => source.networkName === network.name,
      );
      return {
        network,
        sources: sourcesForNetwork,
        historical: new HistoricalSyncService({
          common: this.common,
          syncStore: this.syncStore,
          network,
          sources: sourcesForNetwork,
        }),
        realtime: new RealtimeSyncService({
          common: this.common,
          syncStore: this.syncStore,
          network,
          sources: sourcesForNetwork,
        }),
      };
    });

    this.syncGatewayService = new SyncGateway({
      common: this.common,
      syncStore: this.syncStore,
      networks: networksToSync,
      sources: this.sources,
    });

    this.indexingService = new IndexingService({
      common: this.common,
      syncStore: this.syncStore,
      indexingStore: this.indexingStore,
      syncGatewayService: this.syncGatewayService,
      sources: this.sources,
      networks: networksToSync,
    });

    this.serverService = new ServerService({
      common: this.common,
      indexingStore: this.indexingStore,
    });

    this.codegenService = new CodegenService({ common: this.common });
    this.uiService = new UiService({
      common: this.common,
      sources: this.sources,
    });

    // One-time setup for some services.
    await this.syncStore.migrateUp();

    this.serverService.setup({ registerDevRoutes: isDev });
    await this.serverService.start();
    this.serverService.reloadGraphqlSchema({
      graphqlSchema: this.graphqlSchema,
    });

    // Start the indexing service
    await this.indexingService.reset({
      indexingFunctions: this.indexingFunctions,
      schema: this.schema,
    });
    await this.indexingService.processEvents();

    this.codegenService.generateGraphqlSchemaFile({
      graphqlSchema: this.graphqlSchema,
    });

    this.registerCoreServiceEventListeners();
  }

  private async startSyncServices() {
    try {
      await Promise.all(
        this.syncServices.map(async ({ historical, realtime }) => {
          const blockNumbers = await realtime.setup();
          await historical.setup(blockNumbers);

          historical.start();
          await realtime.start();
        }),
      );
    } catch (error_) {
      const error = error_ as Error;
      error.stack = undefined;
      this.common.logger.fatal({ service: "app", error });
      await this.kill();
    }
  }

  /**
   * Shutdown sequence.
   */
  async kill() {
    this.buildService.clearListeners();
    this.clearCoreServiceEventListeners();

    this.common.telemetry.record({
      event: "App Killed",
      properties: { processDuration: process.uptime() },
    });

    this.uiService.kill();

    await Promise.all([
      ...this.syncServices.map(async ({ realtime, historical }) => {
        await realtime.kill();
        await historical.kill();
      }),
      this.indexingService.kill(),
      this.buildService.kill(),
      this.serverService.kill(),
      this.common.telemetry.kill(),
    ]);

    await this.indexingStore.kill();
    await this.syncStore.kill();

    this.common.logger.debug({
      service: "app",
      msg: "Finished shutdown sequence",
    });
  }

  /**
   * Kill all services other than the build, UI, and common services.
   */
  private async killCoreServices() {
    this.clearCoreServiceEventListeners();

    await Promise.all([
      ...this.syncServices.map(async ({ realtime, historical }) => {
        await realtime.kill();
        await historical.kill();
      }),
      this.indexingService.kill(),
      this.serverService.kill(),
    ]);

    await this.indexingStore.kill();
    await this.syncStore.kill();

    await this.common.metrics.resetMetrics();
  }

  private registerBuildServiceEventListeners() {
    this.buildService.onSerial(
      "newConfig",
      async ({ config, sources, networks }) => {
        this.uiService.ui.indexingError = false;

        await this.killCoreServices();

        this.config = config;
        this.sources = sources;
        this.networks = networks;

        await this.setupCoreServices({ isDev: true });

        await this.startSyncServices();
      },
    );

    this.buildService.onSerial(
      "newSchema",
      async ({ schema, graphqlSchema }) => {
        this.uiService.ui.indexingError = false;

        this.schema = schema;
        this.graphqlSchema = graphqlSchema;

        this.codegenService.generateGraphqlSchemaFile({ graphqlSchema });
        this.serverService.reloadGraphqlSchema({ graphqlSchema });

        await this.indexingService.reset({ schema });
        await this.indexingService.processEvents();
      },
    );

    this.buildService.onSerial(
      "newIndexingFunctions",
      async ({ indexingFunctions }) => {
        this.uiService.ui.indexingError = false;

        this.indexingFunctions = indexingFunctions;

        await this.indexingService.reset({ indexingFunctions });
        await this.indexingService.processEvents();
      },
    );

    this.buildService.onSerial("error", async () => {
      this.uiService.ui.indexingError = true;

      await this.indexingService.kill();

      await Promise.all(
        this.syncServices.map(async ({ realtime, historical }) => {
          await realtime.kill();
          await historical.kill();
        }),
      );
    });
  }

  private registerCoreServiceEventListeners() {
    this.syncServices.forEach(({ network, historical, realtime }) => {
      historical.on("historicalCheckpoint", (checkpoint) => {
        this.syncGatewayService.handleNewHistoricalCheckpoint(checkpoint);
      });

      historical.on("syncComplete", () => {
        this.syncGatewayService.handleHistoricalSyncComplete({
          chainId: network.chainId,
        });
      });

      realtime.on("realtimeCheckpoint", (checkpoint) => {
        this.syncGatewayService.handleNewRealtimeCheckpoint(checkpoint);
      });

      realtime.on("finalityCheckpoint", (checkpoint) => {
        this.syncGatewayService.handleNewFinalityCheckpoint(checkpoint);
      });

      realtime.on("shallowReorg", (checkpoint) => {
        this.syncGatewayService.handleReorg(checkpoint);
      });
    });

    this.syncGatewayService.on("newCheckpoint", async () => {
      await this.indexingService.processEvents();
    });

    this.syncGatewayService.on("reorg", async (checkpoint) => {
      await this.indexingService.handleReorg(checkpoint);
      await this.indexingService.processEvents();
    });

    this.indexingService.on("eventsProcessed", async ({ toCheckpoint }) => {
      if (this.serverService.isHistoricalIndexingComplete) return;
      // If a batch of events are processed AND the historical sync is complete AND
      // the new toTimestamp is greater than the historical sync completion timestamp,
      // historical event processing is complete, and the server should begin responding as healthy.
      if (
        this.syncGatewayService.historicalSyncCompletedAt &&
        toCheckpoint.blockTimestamp >=
          this.syncGatewayService.historicalSyncCompletedAt
      ) {
        this.serverService.setIsHistoricalIndexingComplete();
        await this.indexingStore.publish();
      }
    });

    this.indexingService.on("error", async () => {
      this.uiService.ui.indexingError = true;
    });

    this.serverService.on("admin:reload", async ({ chainId }) => {
      const syncServiceForChainId = this.syncServices.find(
        ({ network }) => network.chainId === chainId,
      );
      if (!syncServiceForChainId) {
        this.common.logger.warn({
          service: "server",
          msg: `No network defined for chainId: ${chainId}`,
        });
        return;
      }

      await this.syncStore.deleteRealtimeData({
        chainId,
        fromBlock: BigInt(0),
      });

      this.syncGatewayService.resetCheckpoints({ chainId });

      // Clear all the metrics for the sources.
      syncServiceForChainId.sources.forEach(
        ({ networkName, contractName }) => {
          this.common.metrics.ponder_historical_total_blocks.set(
            { network: networkName, contract: contractName },
            0,
          );
          this.common.metrics.ponder_historical_completed_blocks.set(
            { network: networkName, contract: contractName },
            0,
          );
          this.common.metrics.ponder_historical_cached_blocks.set(
            { network: networkName, contract: contractName },
            0,
          );
        },
      );

      // Reload the sync services for the specific chain by killing, setting up, and then starting again.
      await syncServiceForChainId.realtime.kill();
      await syncServiceForChainId.historical.kill();

      try {
        const blockNumbers = await syncServiceForChainId.realtime.setup();
        await syncServiceForChainId.historical.setup(blockNumbers);
      } catch (error_) {
        const error = error_ as Error;
        error.stack = undefined;
        this.common.logger.fatal({
          service: "app",
          msg: "Failed to fetch initial realtime data",
          error,
        });
        this.kill();
      }

      await syncServiceForChainId.realtime.start();
      syncServiceForChainId.historical.start();

      // NOTE: We have to reset the historical state after restarting the sync services
      // otherwise the state will be out of sync.
      this.uiService.resetHistoricalState();

      // Reload the indexing service with existing schema. We use the exisiting schema as there is
      // alternative resetting behavior for a schema change.
      await this.indexingService.reset();
      await this.indexingService.processEvents();
    });
  }

  private clearCoreServiceEventListeners() {
    this.syncServices.forEach(({ historical, realtime }) => {
      historical.clearListeners();
      realtime.clearListeners();
    });
    this.syncGatewayService.clearListeners();
    this.indexingService.clearListeners();
    this.serverService.clearListeners();
  }
}
