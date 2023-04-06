import pico from "picocolors";

import { BackfillService } from "@/backfill/BackfillService";
import { CodegenService } from "@/codegen/CodegenService";
import { LoggerService, MessageKind } from "@/common/LoggerService";
import { formatEta, formatPercentage } from "@/common/utils";
import { buildContracts, Contract } from "@/config/contracts";
import { buildLogFilters, LogFilter } from "@/config/logFilters";
import { Network } from "@/config/networks";
import { PonderOptions } from "@/config/options";
import { ResolvedPonderConfig } from "@/config/ponderConfig";
import { buildCacheStore, CacheStore } from "@/database/cache/cacheStore";
import { buildDb, PonderDatabase } from "@/database/db";
import { buildEntityStore, EntityStore } from "@/database/entity/entityStore";
import { ErrorService } from "@/errors/ErrorService";
import { FrontfillService } from "@/frontfill/FrontfillService";
import { EventHandlerService } from "@/handlers/EventHandlerService";
import { ReloadService } from "@/reload/ReloadService";
import { ServerService } from "@/server/ServerService";
import { UiService } from "@/ui/UiService";

export type Resources = {
  options: PonderOptions;
  config: ResolvedPonderConfig;
  database: PonderDatabase;
  cacheStore: CacheStore;
  entityStore: EntityStore;
  logFilters: LogFilter[];
  contracts: Contract[];
  logger: LoggerService;
  errors: ErrorService;
};

export class Ponder {
  resources: Resources;

  frontfillService: FrontfillService;
  backfillService: BackfillService;
  serverService: ServerService;
  reloadService: ReloadService;
  eventHandlerService: EventHandlerService;
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
    const database = buildDb({ options, config, logger });
    const cacheStore = buildCacheStore({ database });
    const entityStore = buildEntityStore({ database });
    const logFilters = buildLogFilters({ options, config });
    const contracts = buildContracts({ options, config });

    const resources: Resources = {
      options,
      config,
      database,
      cacheStore,
      entityStore,
      logFilters,
      contracts,
      logger,
      errors,
    };
    this.resources = resources;

    this.frontfillService = new FrontfillService({ resources });
    this.backfillService = new BackfillService({ resources });
    this.serverService = new ServerService({ resources });
    this.reloadService = new ReloadService({ resources });
    this.eventHandlerService = new EventHandlerService({ resources });
    this.codegenService = new CodegenService({ resources });
    this.uiService = new UiService({ resources });
  }

  async setup() {
    this.registerDevAndStartHandlers();
    this.registerUiHandlers();

    // If any of the provided networks do not have a valid RPC url,
    // kill the app here. This happens here rather than in the constructor because
    // `ponder codegen` should still be able to if an RPC url is missing. In fact,
    // that is part of the happy path for `create-ponder`.
    const networksMissingRpcUrl: Network[] = [];
    this.resources.logFilters.forEach((logFilter) => {
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
    await this.resources.cacheStore.migrate();

    // Manually trigger loading schema and handlers. Subsequent loads
    // are triggered by changes to project files (handled in ReloadService).
    this.reloadService.loadSchema();
    await this.reloadService.loadHandlers();
  }

  async dev() {
    const setupError = await this.setup();
    if (setupError) {
      this.resources.logger.logMessage(MessageKind.ERROR, setupError.message);
      await this.kill();
      return;
    }

    await this.frontfillService.getLatestBlockNumbers();
    this.frontfillService.startFrontfill();
    this.reloadService.watch();
    await this.backfillService.backfill();
    await this.eventHandlerService.processEvents();
  }

  async start() {
    const setupError = await this.setup();
    if (setupError) {
      this.resources.logger.logMessage(MessageKind.ERROR, setupError.message);
      await this.kill();
      return;
    }

    // When ran with `ponder start`, handler errors should kill the process.
    this.resources.errors.on("handlerError", async () => {
      process.exitCode = 1;
      await this.kill();
    });

    await this.frontfillService.getLatestBlockNumbers();
    this.frontfillService.startFrontfill();
    await this.backfillService.backfill();
    await this.eventHandlerService.processEvents();
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
    this.frontfillService.clearListeners();
    this.backfillService.clearListeners();

    await this.reloadService.kill?.();
    this.uiService.kill();
    this.eventHandlerService.killQueue();
    await this.serverService.teardown();
    await this.resources.entityStore.teardown();

    await this.frontfillService.kill();
    await this.backfillService.kill();
  }

  private registerDevAndStartHandlers() {
    this.reloadService.on("ponderConfigChanged", async () => {
      await this.kill();
    });

    this.reloadService.on("newSchema", async ({ schema, graphqlSchema }) => {
      this.codegenService.generateAppFile({ schema });
      this.codegenService.generateSchemaFile({ graphqlSchema });

      this.serverService.reload({ graphqlSchema });

      await this.resources.entityStore.load({ schema });
      this.eventHandlerService.resetEventQueue({ schema });
      await this.eventHandlerService.processEvents();
    });

    this.reloadService.on("newHandlers", async ({ handlers }) => {
      await this.resources.entityStore.reset();
      this.eventHandlerService.resetEventQueue({ handlers });
      await this.eventHandlerService.processEvents();
    });

    this.frontfillService.on("frontfillStarted", async () => {
      await this.eventHandlerService.processEvents();
    });
    this.backfillService.on("backfillStarted", async () => {
      this.eventHandlerService.isBackfillStarted = true;
      await this.eventHandlerService.processEvents();
    });

    this.frontfillService.on("eventsAdded", async () => {
      await this.eventHandlerService.processEvents();
    });
    this.backfillService.on("eventsAdded", async () => {
      await this.eventHandlerService.processEvents();
    });

    this.backfillService.on("backfillCompleted", async () => {
      this.resources.logger.logMessage(
        MessageKind.BACKFILL,
        "backfill complete"
      );
      await this.eventHandlerService.processEvents();
    });

    this.eventHandlerService.on("eventsProcessed", ({ toTimestamp }) => {
      if (this.serverService.isBackfillEventProcessingComplete) return;

      // If a batch of events are processed and the new toTimestamp is greater than
      // the backfill cutoff timestamp, backfill event processing is complete, and the
      // server should begin responding as healthy.
      if (toTimestamp >= this.frontfillService.backfillCutoffTimestamp) {
        this.serverService.isBackfillEventProcessingComplete = true;
        this.resources.logger.logMessage(
          MessageKind.INDEXER,
          "backfill event processing complete (server now responding as healthy)"
        );
        // TODO: figure out how to remove this listener from within itself?
      }
    });
  }

  private registerUiHandlers() {
    this.resources.errors.on("handlerError", ({ error }) => {
      this.resources.logger.logMessage(MessageKind.ERROR, error.message);
    });

    this.frontfillService.on("networkConnected", (e) => {
      this.uiService.ui.networks.push(e.network);
    });

    this.backfillService.on("logFilterStarted", ({ name, cacheRate }) => {
      this.resources.logger.logMessage(
        MessageKind.BACKFILL,
        `started backfill for ${pico.bold(name)} (${formatPercentage(
          cacheRate
        )} cached)`
      );

      this.uiService.ui.stats[name].cacheRate = cacheRate;
    });

    this.backfillService.on("logTasksAdded", ({ name, count }) => {
      this.uiService.ui.stats[name].logTotal += count;
    });
    this.backfillService.on("blockTasksAdded", ({ name, count }) => {
      this.uiService.ui.stats[name].blockTotal += count;
    });

    this.backfillService.on("logTaskCompleted", ({ name }) => {
      if (this.uiService.ui.stats[name].logCurrent === 0) {
        this.uiService.ui.stats[name].logStartTimestamp = Date.now();
      }

      this.uiService.ui.stats[name] = {
        ...this.uiService.ui.stats[name],
        logCurrent: this.uiService.ui.stats[name].logCurrent + 1,
        logAvgDuration:
          (Date.now() - this.uiService.ui.stats[name].logStartTimestamp) /
          this.uiService.ui.stats[name].logCurrent,
        logAvgBlockCount:
          this.uiService.ui.stats[name].blockTotal /
          this.uiService.ui.stats[name].logCurrent,
      };
    });
    this.backfillService.on("blockTaskCompleted", ({ name }) => {
      if (this.uiService.ui.stats[name].blockCurrent === 0) {
        this.uiService.ui.stats[name].blockStartTimestamp = Date.now();
      }

      this.uiService.ui.stats[name] = {
        ...this.uiService.ui.stats[name],
        blockCurrent: this.uiService.ui.stats[name].blockCurrent + 1,
        blockAvgDuration:
          (Date.now() - this.uiService.ui.stats[name].blockStartTimestamp) /
          this.uiService.ui.stats[name].blockCurrent,
      };
    });
    this.backfillService.on("backfillCompleted", ({ duration }) => {
      this.uiService.ui.isBackfillComplete = true;
      this.uiService.ui.backfillDuration = formatEta(duration);
    });

    this.frontfillService.on("logTaskCompleted", ({ network, logData }) => {
      Object.entries(logData).forEach(([blockNumber, logInfo]) => {
        const total = Object.values(logInfo).reduce((sum, a) => sum + a, 0);
        this.resources.logger.logMessage(
          MessageKind.FRONTFILL,
          `${network} @ ${blockNumber} (${total} matched events)`
        );
      });
    });

    this.frontfillService.on("logTaskFailed", ({ network, error }) => {
      this.resources.logger.logMessage(
        MessageKind.WARNING,
        `(${network}) log frontfill task failed with error: ${error.message}`
      );
    });
    this.frontfillService.on("blockTaskFailed", ({ network, error }) => {
      this.resources.logger.logMessage(
        MessageKind.WARNING,
        `(${network}) block frontfill task failed with error: ${error.message}`
      );
    });

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

    this.resources.errors.on("handlerError", () => {
      this.uiService.ui.handlerError = true;
    });
    this.resources.errors.on("handlerErrorCleared", () => {
      this.uiService.ui.handlerError = false;
    });
  }
}
