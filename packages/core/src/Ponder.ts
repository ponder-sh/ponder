import path from "node:path";
import process from "node:process";
import type { IndexingFunctions } from "@/build/functions.js";
import { BuildService } from "@/build/service.js";
import { CodegenService } from "@/codegen/service.js";
import type { Config } from "@/config/config.js";
import { buildDatabase } from "@/config/database.js";
import { type Network } from "@/config/networks.js";
import { type Options } from "@/config/options.js";
import type { Source } from "@/config/sources.js";
import { UserErrorService } from "@/errors/service.js";
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
import type { GraphQLSchema } from "graphql";

export type Common = {
  options: Options;
  logger: LoggerService;
  errors: UserErrorService;
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
    const errors = new UserErrorService();
    const metrics = new MetricsService();
    const telemetry = new TelemetryService({ options });

    this.common = { options, logger, errors, metrics, telemetry };

    this.buildService = new BuildService({ common: this.common });
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

    const config = await this.buildService.loadConfig();
    if (!config) {
      this.common.logger.fatal({
        service: "app",
        msg: "Config build failed: killing app",
      });
      await this.buildService.kill();
      return;
    }

    const schema = await this.buildService.loadSchema();
    if (!schema) {
      this.common.logger.fatal({
        service: "app",
        msg: "Schema build failed: killing app",
      });
      await this.buildService.kill();
      return;
    }

    const indexingFunctions = await this.buildService.loadIndexingFunctions();
    if (!indexingFunctions) {
      this.common.logger.fatal({
        service: "app",
        msg: "Indexing function build failed: killing app",
      });
      await this.buildService.kill();
      return;
    }

    this.config = config.config;
    this.sources = config.sources;
    this.networks = config.networks;
    this.schema = schema.schema;
    this.graphqlSchema = schema.graphqlSchema;
    this.indexingFunctions = indexingFunctions;

    return true;
  }

  private async setupCoreServices({
    syncStore,
    indexingStore,
  }: {
    // These options are only used for testing.
    syncStore?: SyncStore;
    indexingStore?: IndexingStore;
  } = {}) {
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
    this.serverService.setup();

    this.codegenService.generateGraphqlSchemaFile({
      graphqlSchema: this.graphqlSchema,
    });
    this.serverService.reloadGraphqlSchema({
      graphqlSchema: this.graphqlSchema,
    });

    // Start the indexing service
    await this.indexingService.reset({
      indexingFunctions: this.indexingFunctions,
      schema: this.schema,
    });
    await this.indexingService.processEvents();

    // Once all services have been successfully created & started
    // using the initial config, register service dependencies.
    this.registerServiceDependencies();
  }

  /**
   * Setup Ponder services
   * @returns True if setup was successful
   */
  async setup({
    syncStore,
    indexingStore,
  }: {
    // These options are only used for testing.
    syncStore?: SyncStore;
    indexingStore?: IndexingStore;
  } = {}) {
    const success = await this.setupBuildService();
    if (!success) return false;

    await this.setupCoreServices({ syncStore, indexingStore });
    return true;
  }

  async dev() {
    this.common.telemetry.record({
      event: "App Started",
      properties: {
        command: "ponder dev",
        contractCount: this.sources.length,
        databaseKind: this.syncStore.kind,
      },
    });
    this.serverService.registerDevRoutes();
    await this.serverService.start();

    await this.startSyncServices();
  }

  async start() {
    this.common.telemetry.record({
      event: "App Started",
      properties: {
        command: "ponder start",
        contractCount: this.sources.length,
        databaseKind: this.syncStore.kind,
      },
    });

    // If not using `dev`, can kill the build service here to avoid hot reloads.
    await this.buildService.kill();
    await this.serverService.start();

    await this.startSyncServices();
  }

  private async startSyncServices() {
    try {
      await Promise.all(
        this.syncServices.map(async ({ historical, realtime }) => {
          const blockNumbers = await realtime.setup();
          await realtime.start();
          await historical.start(blockNumbers);
        }),
      );
    } catch (error_) {
      const error = error_ as Error;
      error.stack = undefined;
      this.common.logger.fatal({
        service: "app",
        error,
      });
      this.kill();
    }
  }

  async codegen() {
    const result = await this.buildService.loadSchema();
    if (result) {
      const { graphqlSchema } = result;
      this.codegenService.generateGraphqlSchemaFile({ graphqlSchema });
    }

    await this.kill();
  }

  async serve() {
    this.common.logger.debug({
      service: "app",
      msg: `Started using config file: ${path.relative(
        this.common.options.rootDir,
        this.common.options.configFile,
      )}`,
    });

    // Initialize the Vite server and Vite Node runner.
    await this.buildService.setup();

    const config = await this.buildService.loadConfig();
    const schemaResult = await this.buildService.loadSchema();
    if (!config || !schemaResult) {
      await this.buildService.kill();
      // TODO: Better logs/error handling here.
      return;
    }
    // Kill the build service here to avoid hot reloads.
    await this.buildService.kill();

    const database = buildDatabase({
      common: this.common,
      config: config.config,
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

    this.serverService.setup();
    await this.serverService.start();

    const { schema, graphqlSchema } = schemaResult;

    // TODO: Make this less hacky. This was a quick way to make the schema available
    // to the findUnique and findMany functions without having to change the API.
    this.indexingStore.schema = schema;

    this.serverService.reloadGraphqlSchema({ graphqlSchema });

    this.common.telemetry.record({
      event: "App Started",
      properties: {
        command: "ponder serve",
        databaseKind: this.indexingStore.kind,
      },
    });
  }

  /**
   * Shutdown sequence.
   */
  async kill() {
    this.syncGatewayService.clearListeners();

    this.common.telemetry.record({
      event: "App Killed",
      properties: {
        processDuration: process.uptime(),
      },
    });

    await Promise.all(
      this.syncServices.map(async ({ realtime, network }) => {
        network.requestQueue.kill();
        await realtime.kill();
      }),
    );

    this.uiService.kill();

    await Promise.all([
      await this.indexingService.kill(),
      await this.buildService.kill(),
      await this.serverService.kill(),
      await this.common.telemetry.kill(),
    ]);

    await this.indexingStore.kill();
    await this.syncStore.kill();

    this.common.logger.debug({
      service: "app",
      msg: "Finished shutdown sequence",
    });
  }

  /**
   * Very similar to `kill()`, but don't kill the ui service or build service.
   */
  private async reload() {
    this.buildService.clearListeners();
    this.syncServices.forEach(({ historical, realtime }) => {
      historical.clearListeners();
      realtime.clearListeners();
    });
    this.serverService.clearListeners();
    this.indexingService.clearListeners();
    this.common.metrics.resetMetrics();
    this.syncGatewayService.clearListeners();

    await Promise.all([
      await this.indexingService.kill(),
      await this.serverService.kill(),
      await this.common.telemetry.kill(),
    ]);

    await Promise.all(
      this.syncServices.map(async ({ realtime, network }) => {
        network.requestQueue.kill();
        network.requestQueue.clear();

        await realtime.kill();
      }),
    );

    await this.indexingStore.kill();
    await this.syncStore.kill();
  }

  private registerServiceDependencies() {
    this.buildService.on("newConfig", async (build) => {
      if (build) {
        this.common.errors.hasUserError = false;
        this.common.logger.info({
          service: "app",
          msg: "Reloading ponder with new config",
        });

        // Clear all listeners. Will be added back in setup.
        await this.reload();

        this.config = build.config;
        this.sources = build.sources;
        this.networks = build.networks;

        await this.setupCoreServices();
        // NOTE: We know we are in dev mode if the build service is receiving events. Build events are disabled in production.
        await this.dev();
      } else {
        // If the build service emits the "newConfig" event with undefined, it means there was an error
        // while building or validating the config on a hot reload.
        await this.indexingService.kill();
        await Promise.all(
          this.syncServices.map(async ({ realtime, network }) => {
            await realtime.kill();

            network.requestQueue.kill();
            network.requestQueue.clear();
          }),
        );
      }
    });

    this.buildService.on("newSchema", async (build) => {
      if (build) {
        this.common.errors.hasUserError = false;
        this.common.logger.info({
          service: "app",
          msg: "Reloading ponder with new schema",
        });

        this.schema = build.schema;
        this.graphqlSchema = build.graphqlSchema;

        this.codegenService.generateGraphqlSchemaFile({
          graphqlSchema: build.graphqlSchema,
        });
        this.serverService.reloadGraphqlSchema({
          graphqlSchema: build.graphqlSchema,
        });

        await this.indexingService.reset({ schema: build.schema });
        await this.indexingService.processEvents();
      } else {
        // If the build service emits the "newSchema" event with undefined, it means there was an error
        // while building or validating the schema on a hot reload.
        await this.indexingService.kill();
      }
    });

    this.buildService.on(
      "newIndexingFunctions",
      async ({ indexingFunctions }) => {
        this.common.errors.hasUserError = false;

        this.indexingFunctions = indexingFunctions;

        await this.indexingService.reset({ indexingFunctions });
        await this.indexingService.processEvents();
      },
    );

    this.syncServices.forEach(({ network, historical, realtime }) => {
      historical.on("historicalCheckpoint", (checkpoint) => {
        this.syncGatewayService.handleNewHistoricalCheckpoint(checkpoint);
      });

      historical.on("syncComplete", () => {
        this.syncGatewayService.handleHistoricalSyncComplete({
          chainId: network.chainId,
        });
      });

      historical.on("error", async () => {
        this.common.logger.fatal({
          service: "app",
          msg: "Historical sync service failed: killing app",
        });

        await this.kill();
      });

      realtime.on("error", async () => {
        this.common.logger.fatal({
          service: "app",
          msg: "Realtime sync service failed: killing app",
        });

        await this.kill();
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

    // Server listeners.
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

      let blockNumbers: {
        latestBlockNumber: number;
        finalizedBlockNumber: number | undefined;
      };
      try {
        blockNumbers = await syncServiceForChainId.realtime.setup();
      } catch (error_) {
        const error = error_ as Error;
        error.stack = undefined;
        this.common.logger.fatal({
          service: "app",
          msg: "Failed to fetch initial realtime data",
          error,
        });
        this.kill();
        // NOTE: Should we return here?
      }

      await syncServiceForChainId.realtime.start();
      await syncServiceForChainId.historical.start(blockNumbers!);

      // NOTE: We have to reset the historical state after restarting the sync services
      // otherwise the state will be out of sync.
      this.uiService.resetHistoricalState();

      // Reload the indexing service with existing schema. We use the exisiting schema as there is
      // alternative resetting behavior for a schema change.
      await this.indexingService.reset();
      await this.indexingService.processEvents();
    });
  }
}
