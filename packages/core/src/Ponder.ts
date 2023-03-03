import pico from "picocolors";

import { BackfillService } from "@/backfill/BackfillService";
import { CodegenService } from "@/codegen/CodegenService";
import { ErrorService } from "@/common/ErrorService";
import { LoggerService, MessageKind } from "@/common/LoggerService";
import { PonderOptions } from "@/common/options";
import { ResolvedPonderConfig } from "@/config/buildPonderConfig";
import { buildContracts, Contract } from "@/config/contracts";
import { buildNetworks } from "@/config/networks";
import { buildCacheStore, CacheStore } from "@/db/cache/cacheStore";
import { buildDb, PonderDatabase } from "@/db/db";
import { buildEntityStore, EntityStore } from "@/db/entity/entityStore";
import { EventHandlerService } from "@/eventHandler/EventHandlerService";
import { FrontfillService } from "@/frontfill/FrontfillService";
import { ReloadService } from "@/reload/ReloadService";
import { ServerService } from "@/server/ServerService";
import { UiService } from "@/ui/UiService";

import { formatPercentage } from "./common/utils";

export type Resources = {
  options: PonderOptions;
  config: ResolvedPonderConfig;
  database: PonderDatabase;
  cacheStore: CacheStore;
  entityStore: EntityStore;
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
    const logger = new LoggerService();
    const errors = new ErrorService();
    const database = buildDb({ options, config, logger });
    const cacheStore = buildCacheStore({ database });
    const entityStore = buildEntityStore({ database });

    const networks = buildNetworks({ config, cacheStore });
    const contracts = buildContracts({
      options,
      config,
      networks,
    });

    const resources: Resources = {
      options,
      config,
      database,
      cacheStore,
      entityStore,
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

    this.reloadService.on("ponderConfigChanged", async () => {
      await this.kill();
    });

    this.reloadService.on("newSchema", async ({ schema, graphqlSchema }) => {
      this.codegenService.generateAppTypeFile({ schema });
      this.codegenService.generateSchemaFile({ graphqlSchema });

      await this.resources.entityStore.load(schema);
      this.eventHandlerService.resetEventQueue({ schema });
      // process handlers?

      this.serverService.reload({ graphqlSchema });
    });

    this.reloadService.on("newHandlers", async ({ handlers }) => {
      this.eventHandlerService.resetEventQueue({ handlers });
    });

    this.backfillService.on("newEventsAdded", async () => {
      await this.eventHandlerService.processNewEvents();
    });

    this.frontfillService.on("newEventsAdded", async () => {
      await this.eventHandlerService.processNewEvents();
    });

    this.resources.errors.on("handlerError", async () => {
      await this.kill();
    });

    this.registerUiHandlers();
  }

  async setup() {
    this.reloadService.loadSchema();

    await Promise.all([
      this.reloadService.loadHandlers(),
      this.resources.cacheStore.migrate(),
    ]);
  }

  async dev() {
    await this.setup();
    await this.frontfillService.getLatestBlockNumbers();
    this.frontfillService.startFrontfill();
    this.reloadService.watch();
    await this.backfillService.startBackfill();
  }

  async start() {
    await this.setup();
    await this.frontfillService.getLatestBlockNumbers();
    this.frontfillService.startFrontfill();
    await this.backfillService.startBackfill();
  }

  async codegen() {
    await this.setup();

    this.codegenService.generateAppFile();
    this.codegenService.generateContractTypeFiles();
  }

  async kill() {
    await this.reloadService.kill?.();
    this.frontfillService.killQueues();
    this.backfillService.killQueues();
    this.eventHandlerService.killQueue();
    await this.serverService.teardown();
    await this.resources.entityStore.teardown();
  }

  registerUiHandlers() {
    this.frontfillService.on("networkConnected", (e) => {
      this.uiService.ui.networks[e.network] = {
        name: e.network,
        blockNumber: e.blockNumber,
        blockTimestamp: e.blockTimestamp,
        blockTxnCount: -1,
        matchedLogCount: -1,
      };
    });

    this.backfillService.on("contractStarted", (e) => {
      this.resources.logger.logMessage(
        MessageKind.BACKFILL,
        `started backfill for contract ${pico.bold(
          e.contract
        )} (${formatPercentage(e.cacheRate)} cached)`
      );

      this.uiService.ui.stats[e.contract].cacheRate = e.cacheRate;
    });

    this.backfillService.on("logTasksAdded", ({ contract, count }) => {
      this.uiService.ui.stats[contract].logTotal += count;
    });
    this.backfillService.on("blockTasksAdded", ({ contract, count }) => {
      this.uiService.ui.stats[contract].blockTotal += count;
    });

    this.backfillService.on("logTaskFailed", ({ error }) => {
      this.resources.logger.logMessage(
        MessageKind.WARNING,
        `log backfill task failed with error: ${error.message}`
      );
    });
    this.backfillService.on("blockTaskFailed", ({ error }) => {
      this.resources.logger.logMessage(
        MessageKind.WARNING,
        `block backfill task failed with error: ${error.message}`
      );
    });

    this.backfillService.on("logTaskCompleted", ({ contract }) => {
      if (this.uiService.ui.stats[contract].logCurrent === 0) {
        this.uiService.ui.stats[contract].logStartTimestamp = Date.now();
      }

      this.uiService.ui.stats[contract] = {
        ...this.uiService.ui.stats[contract],
        logCurrent: this.uiService.ui.stats[contract].logCurrent + 1,
        logAvgDuration:
          (Date.now() - this.uiService.ui.stats[contract].logStartTimestamp) /
          this.uiService.ui.stats[contract].logCurrent,
        logAvgBlockCount:
          this.uiService.ui.stats[contract].blockTotal /
          this.uiService.ui.stats[contract].logCurrent,
      };
    });
    this.backfillService.on("blockTaskCompleted", ({ contract }) => {
      if (this.uiService.ui.stats[contract].blockCurrent === 0) {
        this.uiService.ui.stats[contract].blockStartTimestamp = Date.now();
      }

      this.uiService.ui.stats[contract] = {
        ...this.uiService.ui.stats[contract],
        blockCurrent: this.uiService.ui.stats[contract].blockCurrent + 1,
        blockAvgDuration:
          (Date.now() - this.uiService.ui.stats[contract].blockStartTimestamp) /
          this.uiService.ui.stats[contract].blockCurrent,
      };
    });

    this.frontfillService.on("newEventsAdded", (e) => {
      if (
        this.resources.options.LOG_TYPE === "start" &&
        this.uiService.ui.isBackfillComplete
      ) {
        this.resources.logger.logMessage(
          MessageKind.FRONTFILL,
          `${e.network} block ${e.blockNumber} (${e.blockTxnCount} txns, ${e.matchedLogCount} matched events)`
        );
      }
      this.uiService.ui.networks[e.network] = {
        name: e.network,
        blockNumber: e.blockNumber,
        blockTimestamp: e.blockTimestamp,
        blockTxnCount: e.blockTxnCount,
        matchedLogCount: e.matchedLogCount,
      };
    });

    this.frontfillService.on("taskFailed", ({ error }) => {
      this.resources.logger.logMessage(
        MessageKind.WARNING,
        `block frontfill task failed with error: ${error.message}`
      );
    });

    this.eventHandlerService.on("taskStarted", () => {
      this.uiService.ui.handlersCurrent += 1;
    });
    this.eventHandlerService.on("taskCompleted", ({ timestamp }) => {
      this.uiService.ui.handlersToTimestamp = timestamp;
      if (this.resources.options.LOG_TYPE === "dev") {
        this.uiService.render();
      }
    });

    this.eventHandlerService.on("eventsAdded", (e) => {
      this.uiService.ui.handlersTotal += e.totalCount;
      this.uiService.ui.handlersHandledTotal += e.handledCount;
    });
    this.eventHandlerService.on("eventsProcessed", (e) => {
      this.uiService.ui.handlersToTimestamp = e.toTimestamp;
    });
  }
}

// // --------------------------- EVENT HANDLERS --------------------------- //

// private dev_error: PonderEvents["dev_error"] = async (e) => {
//   if (this.options.LOG_TYPE === "codegen") return;

//   this.isDevError = true;
//   this.handlerQueue?.kill();
//   this.logMessage(MessageKind.ERROR, e.context + `\n` + e.error?.stack);

//   // If prod, kill the app.
//   if (this.options.LOG_TYPE === "start") {
//     await this.kill();
//     return;
//   }

//   this.uiService.ui = { ...this.ui, handlerError: true };
// };
