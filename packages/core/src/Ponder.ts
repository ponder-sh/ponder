import pico from "picocolors";

import { BackfillService } from "@/backfill/BackfillService";
import { CodegenService } from "@/codegen/CodegenService";
import { ErrorService } from "@/common/ErrorService";
import { LoggerService, MessageKind } from "@/common/LoggerService";
import { PonderOptions } from "@/common/options";
import { formatEta, formatPercentage } from "@/common/utils";
import { ResolvedPonderConfig } from "@/config/buildPonderConfig";
import { buildContracts, Contract, Network } from "@/config/contracts";
import { buildCacheStore, CacheStore } from "@/db/cache/cacheStore";
import { buildDb, PonderDatabase } from "@/db/db";
import { buildEntityStore, EntityStore } from "@/db/entity/entityStore";
import { EventHandlerService } from "@/eventHandler/EventHandlerService";
import { FrontfillService } from "@/frontfill/FrontfillService";
import { ReloadService } from "@/reload/ReloadService";
import { ServerService } from "@/server/ServerService";
import { UiService } from "@/ui/UiService";

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
    const contracts = buildContracts({ options, config });

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
  }

  async setup() {
    // If any of the provided networks do not have a valid RPC url,
    // kill the app here. This happens here rather than in the constructor because
    // `ponder codegen` should still be able to if an RPC url is missing. In fact,
    // that is part of the happy path for `create-ponder`.
    const networksMissingRpcUrl: Network[] = [];
    this.resources.contracts.forEach((contract) => {
      if (!contract.network.rpcUrl) {
        networksMissingRpcUrl.push(contract.network);
      }
    });
    if (networksMissingRpcUrl.length > 0) {
      return new Error(
        `missing RPC URL for networks (${networksMissingRpcUrl.map(
          (n) => `"${n.name}"`
        )}). Did you forget to add an RPC URL in .env.local?`
      );
    }

    // These files depend only on ponder.config.ts, so can generate once on setup.
    // Note that loadHandlers depends on the index.ts file being present.
    this.codegenService.generateAppFile();
    this.codegenService.generateContractTypeFiles();

    // Note that this must occur before loadSchema and loadHandlers.
    await this.resources.cacheStore.migrate();

    // Manually trigger loading schema and handlers. Subsequent loads
    // are triggered by changes to project files (handled in ReloadService).
    this.reloadService.loadSchema();
    await this.reloadService.loadHandlers();
  }

  async dev() {
    this.registerDevAndStartHandlers();
    this.registerUiHandlers();

    const setupError = await this.setup();
    if (setupError) {
      this.resources.logger.logMessage(MessageKind.ERROR, setupError.message);
      await this.kill();
      return;
    }

    await this.frontfillService.getLatestBlockNumbers();
    this.frontfillService.startFrontfill();
    this.reloadService.watch();
    await this.backfillService.startBackfill();
  }

  async start() {
    this.registerDevAndStartHandlers();
    this.registerUiHandlers();

    const setupError = await this.setup();
    if (setupError) {
      this.resources.logger.logMessage(MessageKind.ERROR, setupError.message);
      await this.kill();
      return;
    }

    // When ran with `ponder start`, handler errors should kill the process.
    this.resources.errors.on("handlerError", async () => {
      await this.kill();
    });

    await this.frontfillService.getLatestBlockNumbers();
    this.frontfillService.startFrontfill();
    await this.backfillService.startBackfill();
  }

  async codegen() {
    this.codegenService.generateAppFile();
    this.codegenService.generateContractTypeFiles();

    const result = this.reloadService.loadSchema();
    if (result) {
      const { schema, graphqlSchema } = result;
      this.codegenService.generateAppTypeFile({ schema });
      this.codegenService.generateSchemaFile({ graphqlSchema });
    }

    await this.kill();
  }

  async kill() {
    await this.reloadService.kill?.();
    this.uiService.kill();
    this.frontfillService.killQueues();
    this.backfillService.killQueues();
    this.eventHandlerService.killQueue();
    await this.serverService.teardown();
    await this.resources.entityStore.teardown();
  }

  private registerDevAndStartHandlers() {
    this.reloadService.on("ponderConfigChanged", async () => {
      await this.kill();
    });

    this.reloadService.on("newSchema", async ({ schema, graphqlSchema }) => {
      this.codegenService.generateAppTypeFile({ schema });
      this.codegenService.generateSchemaFile({ graphqlSchema });

      this.serverService.reload({ graphqlSchema });

      await this.resources.entityStore.load(schema);
      this.eventHandlerService.resetEventQueue({ schema });
      await this.eventHandlerService.processEvents();
    });

    this.reloadService.on("newHandlers", async ({ handlers }) => {
      await this.resources.entityStore.load();
      this.eventHandlerService.resetEventQueue({ handlers });
      await this.eventHandlerService.processEvents();
    });

    this.frontfillService.on("newEventsAdded", async () => {
      await this.eventHandlerService.processEvents();
    });

    this.backfillService.on("newEventsAdded", async () => {
      await this.eventHandlerService.processEvents();
    });

    this.backfillService.on("backfillCompleted", async () => {
      this.resources.logger.logMessage(
        MessageKind.BACKFILL,
        "backfill complete"
      );
      await this.eventHandlerService.processEvents();
    });

    this.resources.errors.on("handlerError", async ({ context, error }) => {
      this.eventHandlerService.killQueue();
      this.resources.logger.logMessage(
        MessageKind.ERROR,
        context + `\n` + error.stack
      );
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
    this.frontfillService.on("networkConnected", (e) => {
      this.uiService.ui.networks[e.network] = {
        name: e.network,
        blockNumber: e.blockNumber,
        blockTimestamp: e.blockTimestamp,
        blockTxnCount: -1,
        matchedLogCount: -1,
      };
    });

    this.backfillService.on("contractStarted", ({ contract, cacheRate }) => {
      this.resources.logger.logMessage(
        MessageKind.BACKFILL,
        `started backfill for contract ${pico.bold(
          contract
        )} (${formatPercentage(cacheRate)} cached)`
      );

      this.uiService.ui.stats[contract].cacheRate = cacheRate;
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
    this.backfillService.on("backfillCompleted", ({ duration }) => {
      this.uiService.ui.isBackfillComplete = true;
      this.uiService.ui.backfillDuration = formatEta(duration);
    });

    this.frontfillService.on(
      "newEventsAdded",
      ({
        network,
        blockNumber,
        blockTimestamp,
        blockTxnCount,
        matchedLogCount,
      }) => {
        if (matchedLogCount > 0) {
          this.resources.logger.logMessage(
            MessageKind.FRONTFILL,
            `${network} block ${blockNumber} (${blockTxnCount} txns, ${matchedLogCount} matched events)`
          );
        }

        this.uiService.ui.networks[network] = {
          name: network,
          blockNumber: blockNumber,
          blockTimestamp: blockTimestamp,
          blockTxnCount: blockTxnCount,
          matchedLogCount: matchedLogCount,
        };
      }
    );

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
