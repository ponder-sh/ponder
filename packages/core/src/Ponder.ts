import path from "node:path";
import process from "node:process";

import { BuildService } from "@/build/service";
import { CodegenService } from "@/codegen/service";
import { type ResolvedConfig } from "@/config/config";
import { buildContracts } from "@/config/contracts";
import { buildDatabase } from "@/config/database";
import { type LogFilter, buildLogFilters } from "@/config/logFilters";
import { type Network, buildNetwork } from "@/config/network";
import { type Options } from "@/config/options";
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
  network: Network;
  logFilters: LogFilter[];

  eventStore: EventStore;
  userStore: UserStore;

  historicalSyncService: HistoricalSyncService;
  realtimeSyncService: RealtimeSyncService;

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

    const network = buildNetwork({ network: config.network });
    const logFilters = buildLogFilters({ options, config, network });
    const contracts = buildContracts({ options, config, network });

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

    this.historicalSyncService = new HistoricalSyncService({
      common,
      eventStore: this.eventStore,
      network,
      logFilters,
    });

    this.realtimeSyncService = new RealtimeSyncService({
      common,
      eventStore: this.eventStore,
      network,
      logFilters,
    });

    this.eventAggregatorService = new EventAggregatorService({
      common,
      eventStore: this.eventStore,
      network,
      logFilters,
    });

    this.eventHandlerService = new EventHandlerService({
      common,
      eventStore: this.eventStore,
      userStore: this.userStore,
      eventAggregatorService: this.eventAggregatorService,
      contracts,
      logFilters,
    });

    this.buildService = new BuildService({ common, logFilters });
    this.codegenService = new CodegenService({
      common,
      contracts,
      logFilters,
    });
    this.serverService = new ServerService({
      common,
      userStore: this.userStore,
    });
    this.uiService = new UiService({ common, logFilters });

    this.logFilters = logFilters;
    this.network = network;
  }

  async setup() {
    this.common.logger.debug({
      service: "app",
      msg: `Started using config file: ${path.relative(
        this.common.options.rootDir,
        this.common.options.configFile
      )}`,
    });

    this.registerServiceDependencies();

    // If the user did not provide a valid RPC url, kill the app here.
    // This happens here rather than in the constructor because `ponder codegen`
    // should still be able to if an RPC url is missing.
    if (!this.network.rpcUrl) {
      return new Error(
        `missing RPC URL for network "${this.network.name}". Did you forget to include one in .env.local?`
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
    // are triggered by changes to project files (handled in BuildService).
    this.buildService.buildSchema();
    await this.buildService.buildHandlers();

    return undefined;
  }

  async dev() {
    const setupError = await this.setup();

    this.common.telemetry.record({
      event: "App Started",
      properties: {
        command: "ponder dev",
        hasSetupError: !!setupError,
        logFilterCount: this.logFilters.length,
        databaseKind: this.eventStore.kind,
      },
    });

    if (setupError) {
      this.common.logger.error({
        service: "app",
        msg: setupError.message,
        error: setupError,
      });
      return await this.kill();
    }

    const blockNumbers = await this.realtimeSyncService.setup();
    await this.historicalSyncService.setup(blockNumbers);
    this.historicalSyncService.start();
    this.realtimeSyncService.start();

    this.buildService.watch();
  }

  async start() {
    const setupError = await this.setup();

    this.common.telemetry.record({
      event: "App Started",
      properties: {
        command: "ponder start",
        hasSetupError: !!setupError,
        logFilterCount: this.logFilters.length,
        databaseKind: this.eventStore.kind,
      },
    });

    if (setupError) {
      this.common.logger.error({
        service: "app",
        msg: setupError.message,
        error: setupError,
      });
      return await this.kill();
    }

    const blockNumbers = await this.realtimeSyncService.setup();
    await this.historicalSyncService.setup(blockNumbers);
    this.historicalSyncService.start();
    this.realtimeSyncService.start();
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

    await this.realtimeSyncService.kill();
    await this.historicalSyncService.kill();

    await this.buildService.kill?.();
    this.uiService.kill();
    this.eventHandlerService.kill();
    await this.serverService.kill();
    await this.userStore.teardown();
    await this.common.telemetry.kill();

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

      await this.eventHandlerService.reset({ schema });
      await this.eventHandlerService.processEvents();
    });

    this.buildService.on("newHandlers", async ({ handlers }) => {
      await this.eventHandlerService.reset({ handlers });
      await this.eventHandlerService.processEvents();
    });

    this.historicalSyncService.on("historicalCheckpoint", ({ blockNumber }) => {
      this.eventAggregatorService.handleNewHistoricalCheckpoint({
        blockNumber,
      });
    });

    this.historicalSyncService.on("syncComplete", () => {
      this.eventAggregatorService.handleHistoricalSyncComplete();
    });

    this.realtimeSyncService.on("realtimeCheckpoint", ({ blockNumber }) => {
      this.eventAggregatorService.handleNewRealtimeCheckpoint({
        blockNumber,
      });
    });

    this.realtimeSyncService.on("finalityCheckpoint", ({ blockNumber }) => {
      this.eventAggregatorService.handleNewFinalityCheckpoint({
        blockNumber,
      });
    });

    this.realtimeSyncService.on(
      "shallowReorg",
      ({ commonAncestorBlockNumber }) => {
        this.eventAggregatorService.handleReorg({ commonAncestorBlockNumber });
      }
    );

    this.eventAggregatorService.on("newCheckpoint", async () => {
      await this.eventHandlerService.processEvents();
    });

    this.eventAggregatorService.on(
      "reorg",
      async ({ commonAncestorBlockNumber }) => {
        await this.eventHandlerService.handleReorg({
          commonAncestorBlockNumber,
        });
        await this.eventHandlerService.processEvents();
      }
    );

    this.eventHandlerService.on("historicalEventProcessingCompleted", () => {
      this.serverService.setIsHistoricalEventProcessingComplete();
    });
  }
}
