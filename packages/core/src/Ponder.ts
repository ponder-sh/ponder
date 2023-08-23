import assert from "node:assert";
import path from "node:path";
import process from "node:process";

import { BuildService } from "@/build/service";
import { CodegenService } from "@/codegen/service";
import { type ResolvedConfig } from "@/config/config";
import { buildContracts } from "@/config/contracts";
import { buildDatabase } from "@/config/database";
import { type LogFilter } from "@/config/logFilters";
import { type Network, buildNetwork } from "@/config/networks";
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
  logFilters: LogFilter[] = [];

  config?: ResolvedConfig;
  eventStore?: EventStore;
  userStore?: UserStore;

  // List of indexing-related services. One per configured network.
  networkSyncServices: {
    network: Network;
    logFilters: LogFilter[];
    historicalSyncService: HistoricalSyncService;
    realtimeSyncService: RealtimeSyncService;
  }[] = [];

  buildService: BuildService;

  eventAggregatorService?: EventAggregatorService;
  eventHandlerService?: EventHandlerService;

  serverService?: ServerService;
  codegenService?: CodegenService;
  uiService?: UiService;

  constructor({
    options,
    config,
    eventStore,
    userStore,
  }: {
    options: Options;
    // These options are only used for testing.
    config?: ResolvedConfig;
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
    this.buildService = new BuildService({ common });

    this.config = config;
    this.eventStore = eventStore;
    this.userStore = userStore;
  }

  async init() {
    const config = this.config ?? this.buildService.config;
    assert(config, "Config is not set in init");
    const options = this.common.options;
    const logFilters = this.buildService.buildLogFilters();
    this.logFilters = logFilters;
    const contracts = buildContracts({ options, config });

    const networks = config.networks
      .map((network) => buildNetwork({ network }))
      .filter((network) => {
        const hasLogFilters = logFilters.some(
          (logFilter) => logFilter.network === network.name
        );
        if (!hasLogFilters) {
          this.common.logger.warn({
            service: "app",
            msg: `No log filters found (network=${network.name})`,
          });
        }
        return hasLogFilters;
      });

    const database = buildDatabase({ options, config });
    this.eventStore =
      this.eventStore ??
      (database.kind === "sqlite"
        ? new SqliteEventStore({ db: database.db })
        : new PostgresEventStore({ pool: database.pool }));

    this.userStore =
      this.userStore ??
      (database.kind === "sqlite"
        ? new SqliteUserStore({ db: database.db })
        : new PostgresUserStore({ pool: database.pool }));

    // Reset metrics before instantiating sync services
    // Required during config rebuilds
    this.common.metrics.resetMetrics();

    networks.forEach((network) => {
      assert(this.eventStore);

      const logFiltersForNetwork = logFilters.filter(
        (logFilter) => logFilter.network === network.name
      );
      this.networkSyncServices.push({
        network,
        logFilters: logFiltersForNetwork,
        historicalSyncService: new HistoricalSyncService({
          common: this.common,
          eventStore: this.eventStore,
          network,
          logFilters: logFiltersForNetwork,
        }),
        realtimeSyncService: new RealtimeSyncService({
          common: this.common,
          eventStore: this.eventStore,
          network,
          logFilters: logFiltersForNetwork,
        }),
      });
    });

    this.eventAggregatorService = new EventAggregatorService({
      common: this.common,
      eventStore: this.eventStore,
      networks,
      logFilters,
    });

    this.eventHandlerService = new EventHandlerService({
      common: this.common,
      eventStore: this.eventStore,
      userStore: this.userStore,
      eventAggregatorService: this.eventAggregatorService,
      contracts,
      logFilters,
    });

    this.serverService = new ServerService({
      common: this.common,
      userStore: this.userStore,
    });
    this.codegenService = new CodegenService({
      common: this.common,
      contracts,
      logFilters,
    });
    this.uiService = new UiService({ common: this.common, logFilters });
  }

  async setup() {
    await this.buildService.buildConfig();

    await this.init();
    assert(this.serverService);
    assert(this.codegenService);
    assert(this.eventStore);

    this.common.logger.debug({
      service: "app",
      msg: `Started using config file: ${path.relative(
        this.common.options.rootDir,
        this.common.options.configFile
      )}`,
    });

    this.registerServiceDependencies();

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
    // are triggered by changes to project files (handled in BuildService).
    this.buildService.buildSchema();
    await this.buildService.buildHandlers();

    return undefined;
  }

  async dev() {
    const setupError = await this.setup();
    assert(this.eventStore);

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
      return await this.killCoreServices();
    }

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
    const setupError = await this.setup();
    assert(this.eventStore);

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
    await this.init();
    assert(this.codegenService);
    this.codegenService.generateAppFile();

    const result = this.buildService.buildSchema();
    if (result) {
      const { schema, graphqlSchema } = result;
      this.codegenService.generateAppFile({ schema });
      this.codegenService.generateSchemaFile({ graphqlSchema });
    }

    await this.kill();
  }

  async killCoreServices() {
    assert(this.eventAggregatorService);
    assert(this.uiService);
    assert(this.eventHandlerService);
    assert(this.serverService);
    assert(this.userStore);

    this.eventAggregatorService.clearListeners();

    await Promise.all(
      this.networkSyncServices.map(
        async ({ realtimeSyncService, historicalSyncService }) => {
          await realtimeSyncService.kill();
          await historicalSyncService.kill();
        }
      )
    );

    this.networkSyncServices = [];
    this.uiService.kill();
    this.eventHandlerService.kill();
    await this.serverService.kill();
    await this.userStore.teardown();
  }

  async kill() {
    this.common.telemetry.record({
      event: "App Killed",
      properties: {
        processDuration: process.uptime(),
      },
    });

    await this.killCoreServices();
    await this.buildService.kill?.();
    await this.common.telemetry.kill();

    this.common.logger.debug({
      service: "app",
      msg: `Finished shutdown sequence`,
    });
  }

  private registerServiceDependencies() {
    assert(this.eventAggregatorService);
    assert(this.eventHandlerService);
    this.buildService.on("newConfig", async () => {
      this.common.logger.info({
        service: "build",
        msg: "Detected change in ponder.config.ts",
      });
      await this.killCoreServices();
      await this.dev();
    });

    this.buildService.on("newSchema", async ({ schema, graphqlSchema }) => {
      assert(this.codegenService, "Codegen service not set on schema update");
      assert(this.serverService, "Server service not set on schema update");
      assert(
        this.eventHandlerService,
        "Event handler service not set on schema update"
      );

      this.codegenService.generateAppFile({ schema });
      this.codegenService.generateSchemaFile({ graphqlSchema });

      this.serverService.reload({ graphqlSchema });

      await this.eventHandlerService.reset({ schema });
      await this.eventHandlerService.processEvents();
    });

    this.buildService.on("newHandlers", async ({ handlers }) => {
      assert(
        this.eventHandlerService,
        "Event handler service not set on handlers update"
      );
      await this.eventHandlerService.reset({ handlers });
      await this.eventHandlerService.processEvents();
    });

    this.networkSyncServices.forEach((networkSyncService) => {
      const { chainId } = networkSyncService.network;
      const { historicalSyncService, realtimeSyncService } = networkSyncService;

      historicalSyncService.on("historicalCheckpoint", ({ timestamp }) => {
        assert(
          this.eventAggregatorService,
          "Event aggregator service not set on historical checkpoint update"
        );
        this.eventAggregatorService.handleNewHistoricalCheckpoint({
          chainId,
          timestamp,
        });
      });

      historicalSyncService.on("syncComplete", () => {
        assert(
          this.eventAggregatorService,
          "Event aggregator service not set on sync complete"
        );
        this.eventAggregatorService.handleHistoricalSyncComplete({
          chainId,
        });
      });

      realtimeSyncService.on("realtimeCheckpoint", ({ timestamp }) => {
        assert(
          this.eventAggregatorService,
          "Event aggregator service not set on relatime checkpoint update"
        );
        this.eventAggregatorService.handleNewRealtimeCheckpoint({
          chainId,
          timestamp,
        });
      });

      realtimeSyncService.on("finalityCheckpoint", ({ timestamp }) => {
        assert(
          this.eventAggregatorService,
          "Event aggregator service not set on finality checkpoint update"
        );
        this.eventAggregatorService.handleNewFinalityCheckpoint({
          chainId,
          timestamp,
        });
      });

      realtimeSyncService.on("shallowReorg", ({ commonAncestorTimestamp }) => {
        assert(
          this.eventAggregatorService,
          "Event aggregator service not set on shallow reorg"
        );
        this.eventAggregatorService.handleReorg({ commonAncestorTimestamp });
      });
    });

    this.eventAggregatorService.on("newCheckpoint", async () => {
      assert(
        this.eventHandlerService,
        "Event handler service not set on new checkpoint update"
      );
      await this.eventHandlerService.processEvents();
    });

    this.eventAggregatorService.on(
      "reorg",
      async ({ commonAncestorTimestamp }) => {
        assert(
          this.eventHandlerService,
          "Event handler service not set on reorg"
        );
        await this.eventHandlerService.handleReorg({ commonAncestorTimestamp });
        await this.eventHandlerService.processEvents();
      }
    );

    this.eventHandlerService.on("eventsProcessed", ({ toTimestamp }) => {
      assert(this.serverService, "Server service not set on events processed");
      assert(
        this.eventAggregatorService,
        "Event aggregator service not set on events processed"
      );
      if (this.serverService.isHistoricalEventProcessingComplete) return;

      // If a batch of events are processed AND the historical sync is complete AND
      // the new toTimestamp is greater than the historical sync completion timestamp,
      // historical event processing is complete, and the server should begin responding as healthy.
      if (
        this.eventAggregatorService.historicalSyncCompletedAt &&
        toTimestamp >= this.eventAggregatorService.historicalSyncCompletedAt
      ) {
        this.serverService.setIsHistoricalEventProcessingComplete();
      }
    });
  }
}
