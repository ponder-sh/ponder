import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import type { IndexingFunctions } from "@/build/functions/functions.js";
import { BuildService } from "@/build/service.js";
import { CodegenService } from "@/codegen/service.js";
import { type DatabaseConfig } from "@/config/database.js";
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
import type { GraphQLSchema } from "graphql";
import type { FunctionIds, TableIds } from "./build/static/ids.js";
import type { TableAccess } from "./build/static/parseAst.js";
import { PostgresDatabaseService } from "./database/postgres/service.js";
import type { DatabaseService } from "./database/service.js";
import { SqliteDatabaseService } from "./database/sqlite/service.js";
import { type RequestQueue, createRequestQueue } from "./utils/requestQueue.js";

export type Common = {
  options: Options;
  logger: LoggerService;
  metrics: MetricsService;
  telemetry: TelemetryService;
};

export class Ponder {
  common: Common;
  buildService: BuildService;

  database: DatabaseService = undefined!;

  // User config and build artifacts
  databaseConfig: DatabaseConfig = undefined!;
  sources: Source[] = undefined!;
  networks: Network[] = undefined!;
  schema: Schema = undefined!;
  graphqlSchema: GraphQLSchema = undefined!;
  indexingFunctions: IndexingFunctions = undefined!;
  tableAccess: TableAccess = undefined!;
  tableIds: TableIds = undefined!;
  functionIds: FunctionIds = undefined!;

  // Sync services
  syncStore: SyncStore = undefined!;
  syncServices: {
    network: Network;
    requestQueue: RequestQueue;
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

  async dev(databaseConfigOverride?: DatabaseConfig) {
    const dotEnvPath = path.join(this.common.options.rootDir, ".env.local");
    if (!existsSync(dotEnvPath)) {
      this.common.logger.warn({
        service: "app",
        msg: "Local environment file (.env.local) not found",
      });
    }

    const success = await this.setupBuildService();
    if (!success) return;

    if (databaseConfigOverride) this.databaseConfig = databaseConfigOverride;

    this.common.telemetry.record({
      event: "App Started",
      properties: {
        command: "ponder dev",
        contractCount: this.sources.length,
        databaseKind: this.databaseConfig.kind,
      },
    });

    await this.setupCoreServices({ isDev: true });
    this.registerCoreServiceEventListeners();

    // If running `ponder dev`, register build service listeners to handle hot reloads.
    this.registerBuildServiceEventListeners();

    await this.startSyncServices();
  }

  async start(databaseConfigOverride?: DatabaseConfig) {
    const success = await this.setupBuildService();
    if (!success) return;

    if (databaseConfigOverride) this.databaseConfig = databaseConfigOverride;

    this.common.telemetry.record({
      event: "App Started",
      properties: {
        command: "ponder start",
        contractCount: this.sources.length,
        databaseKind: this.databaseConfig.kind,
      },
    });

    await this.setupCoreServices({ isDev: false });
    this.registerCoreServiceEventListeners();

    await this.startSyncServices();
  }

  async serve() {
    const success = await this.setupBuildService();
    if (!success) return;

    this.common.telemetry.record({
      event: "App Started",
      properties: {
        command: "ponder serve",
        databaseKind: this.databaseConfig.kind,
      },
    });

    if (this.databaseConfig.kind === "sqlite") {
      throw new Error(`The 'ponder serve' command only works with Postgres.`);
    }

    const database = new PostgresDatabaseService({
      common: this.common,
      poolConfig: this.databaseConfig.poolConfig,
    });
    this.database = database;
    await this.database.setup();
    await this.database.reset({
      schema: this.schema,
      tableIds: this.tableIds,
      functionIds: this.functionIds,
      tableAccess: this.tableAccess,
    });

    const indexingStoreConfig = database.getIndexingStoreConfig();
    this.indexingStore = new PostgresIndexingStore({
      common: this.common,
      schema: this.schema,
      ...indexingStoreConfig,
    });
    // this.common.metrics.registerDatabaseMetrics(database);

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

    this.codegenService = new CodegenService({ common: this.common });

    this.codegenService.generateGraphqlSchemaFile({
      graphqlSchema: this.graphqlSchema,
    });
    this.codegenService.generatePonderEnv();

    this.buildService.clearListeners();
    await this.buildService.kill();
    await this.common.telemetry.kill();
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
      await this.common.telemetry.kill();
      return false;
    }

    this.databaseConfig = result.databaseConfig;
    this.sources = result.sources;
    this.networks = result.networks;
    this.schema = result.schema;
    this.graphqlSchema = result.graphqlSchema;
    this.indexingFunctions = result.indexingFunctions;
    this.tableAccess = result.tableAccess;
    this.tableIds = result.tableIds;
    this.functionIds = result.functionIds;

    return true;
  }

  private async setupCoreServices({ isDev }: { isDev: boolean }) {
    // TODO: Figure out metrics for the database.
    // this.common.metrics.registerDatabaseMetrics(database)

    if (this.databaseConfig.kind === "sqlite") {
      const database = new SqliteDatabaseService({
        common: this.common,
        directory: this.databaseConfig.directory,
      });
      this.database = database;

      await database.setup();
      await this.database.reset({
        schema: this.schema,
        tableIds: this.tableIds,
        functionIds: this.functionIds,
        tableAccess: this.tableAccess,
      });

      const indexingStoreConfig = this.database.getIndexingStoreConfig();
      this.indexingStore = new SqliteIndexingStore({
        common: this.common,
        schema: this.schema,
        ...indexingStoreConfig,
      });

      const syncStoreConfig = this.database.getSyncStoreConfig();
      this.syncStore = new SqliteSyncStore({
        common: this.common,
        ...syncStoreConfig,
      });

      await this.syncStore.migrateUp();
    } else {
      const database = new PostgresDatabaseService({
        common: this.common,
        poolConfig: this.databaseConfig.poolConfig,
      });
      this.database = database;

      await database.setup();
      await this.database.reset({
        schema: this.schema,
        tableIds: this.tableIds,
        functionIds: this.functionIds,
        tableAccess: this.tableAccess,
      });

      const indexingStoreConfig = database.getIndexingStoreConfig();
      this.indexingStore = new PostgresIndexingStore({
        common: this.common,
        schema: this.schema,
        ...indexingStoreConfig,
      });

      const syncStoreConfig = await this.database.getSyncStoreConfig();
      this.syncStore = new PostgresSyncStore({
        common: this.common,
        ...syncStoreConfig,
      });

      await this.syncStore.migrateUp();
    }

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

      const requestQueue = createRequestQueue({
        network,
        metrics: this.common.metrics,
      });

      return {
        network,
        requestQueue,
        sources: sourcesForNetwork,
        historical: new HistoricalSyncService({
          common: this.common,
          syncStore: this.syncStore,
          network,
          requestQueue,
          sources: sourcesForNetwork,
        }),
        realtime: new RealtimeSyncService({
          common: this.common,
          syncStore: this.syncStore,
          network,
          requestQueue,
          sources: sourcesForNetwork,
        }),
      };
    });

    this.syncGatewayService = new SyncGateway({
      common: this.common,
      syncStore: this.syncStore,
      networks: networksToSync,
    });

    this.indexingService = new IndexingService({
      common: this.common,
      database: this.database,
      syncStore: this.syncStore,
      indexingStore: this.indexingStore,
      syncGatewayService: this.syncGatewayService,
      sources: this.sources,
      networks: this.syncServices.map((s) => s.network),
      requestQueues: this.syncServices.map((s) => s.requestQueue),
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

    this.serverService.setup({ registerDevRoutes: isDev });
    await this.serverService.start();
    this.serverService.reloadGraphqlSchema({
      graphqlSchema: this.graphqlSchema,
    });

    // Start the indexing service
    await this.indexingService.reset({
      indexingFunctions: this.indexingFunctions,
      schema: this.schema,
      tableAccess: this.tableAccess,
      tableIds: this.tableIds,
      functionIds: this.functionIds,
    });

    await this.indexingService.processEvents();

    this.codegenService.generateGraphqlSchemaFile({
      graphqlSchema: this.graphqlSchema,
    });
    this.codegenService.generatePonderEnv();
  }

  private async startSyncServices() {
    try {
      await Promise.all(
        this.syncServices.map(async ({ historical, realtime }) => {
          const blockNumbers = await realtime.setup();
          await historical.setup(blockNumbers);

          historical.start();
          realtime.start();
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
    this.common.logger.info({
      service: "app",
      msg: "Started shutdown sequence",
    });
    this.common.telemetry.record({
      event: "App Killed",
      properties: { processDuration: process.uptime() },
    });

    this.clearBuildServiceEventListeners();
    this.clearCoreServiceEventListeners();

    await Promise.all([
      this.buildService.kill(),
      this.serverService.kill(),
      this.common.telemetry.kill(),
    ]);
    this.uiService.kill();

    await this.killCoreServices();

    // Now all resources should be cleaned up. The process should exit gracefully.
    this.common.logger.debug({
      service: "app",
      msg: "Finished shutdown sequence",
    });
  }

  /**
   * Kill sync and indexing services and stores.
   */
  private async killCoreServices() {
    // 1) Kill misc services.
    await this.serverService.kill();
    this.uiService.kill();

    // 2) Kill core services. Note that these methods pause and clear the queues
    // and set a boolean flag that allows tasks to fail silently with no retries.
    await this.indexingService.kill();
    this.syncServices.forEach(({ realtime, historical, requestQueue }) => {
      realtime.kill();
      historical.kill();
      requestQueue.clear(); // TODO: Remove this once viem supports canceling requests.
    });

    // 3) Cancel pending RPC requests and database queries.
    // TODO: Once supported by viem, cancel in-progress requests too. This will
    // cause errors in the sync and indexing services, but they will be silent
    // and the failed tasks will not be retried.
    await Promise.all(
      this.syncServices.map(({ requestQueue }) => requestQueue.onIdle()),
    );

    await this.database.kill();
  }

  private registerBuildServiceEventListeners() {
    this.buildService.onSerial(
      "newConfig",
      async ({ databaseConfig, sources, networks, functionIds, tableIds }) => {
        this.uiService.ui.indexingError = false;

        this.clearCoreServiceEventListeners();
        await this.killCoreServices();

        await this.common.metrics.resetMetrics();

        this.databaseConfig = databaseConfig;
        this.sources = sources;
        this.networks = networks;

        this.tableIds = tableIds;
        this.functionIds = functionIds;

        await this.setupCoreServices({ isDev: true });
        this.registerCoreServiceEventListeners();

        await this.startSyncServices();
      },
    );

    /**
     * 1) Pause/reset the indexing service.
     * 2) Reset the database.
     * 3) Start everything.
     *
     *
     */

    this.buildService.onSerial(
      "newSchema",
      async ({ schema, graphqlSchema, tableIds, functionIds }) => {
        this.uiService.ui.indexingError = false;

        this.schema = schema;
        this.graphqlSchema = graphqlSchema;
        this.tableIds = tableIds;
        this.functionIds = functionIds;

        this.codegenService.generateGraphqlSchemaFile({ graphqlSchema });
        this.serverService.reloadGraphqlSchema({ graphqlSchema });

        await this.database.reset({
          schema,
          tableIds,
          functionIds,
          tableAccess: this.tableAccess,
        });

        await this.indexingService.reset({
          schema,
          tableAccess: this.tableAccess,
          tableIds,
          functionIds,
        });

        await this.indexingService.processEvents();
      },
    );

    this.buildService.onSerial(
      "newIndexingFunctions",
      async ({ indexingFunctions, tableAccess, tableIds, functionIds }) => {
        this.uiService.ui.indexingError = false;

        this.indexingFunctions = indexingFunctions;
        this.tableAccess = tableAccess;
        this.tableIds = tableIds;
        this.functionIds = functionIds;

        await this.database.reset({
          schema: this.schema,
          tableIds,
          functionIds,
          tableAccess,
        });

        await this.indexingService.reset({
          indexingFunctions,
          tableAccess,
          tableIds,
          functionIds,
        });

        await this.indexingService.processEvents();
      },
    );

    this.buildService.onSerial("error", async () => {
      this.uiService.ui.indexingError = true;

      this.indexingService.kill();

      for (const { realtime, historical } of this.syncServices) {
        realtime.kill();
        historical.kill();
      }
    });
  }

  private clearBuildServiceEventListeners() {
    this.buildService.clearListeners();
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

      realtime.on("fatal", async () => {
        this.common.logger.fatal({
          service: "app",
          msg: "Realtime sync service failed",
        });
        await this.kill();
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
        this.syncGatewayService.historicalSyncCompletedAt !== undefined &&
        toCheckpoint.blockTimestamp >=
          this.syncGatewayService.historicalSyncCompletedAt
      ) {
        this.serverService.setIsHistoricalIndexingComplete();
        await this.database.publish();
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
      syncServiceForChainId.realtime.kill();
      syncServiceForChainId.historical.kill();

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
        await this.kill();
      }

      syncServiceForChainId.realtime.start();
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
