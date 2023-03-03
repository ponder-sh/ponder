import { BackfillService } from "@/backfill/BackfillService";
import { ErrorService } from "@/common/ErrorService";
import { LoggerService } from "@/common/LoggerService";
import { PonderOptions } from "@/common/options";
import { ResolvedPonderConfig } from "@/config/buildPonderConfig";
import { buildContracts, Contract } from "@/config/contracts";
import { buildNetworks } from "@/config/networks";
import { buildCacheStore, CacheStore } from "@/db/cache/cacheStore";
import { buildDb } from "@/db/db";
import { buildEntityStore, EntityStore } from "@/db/entity/entityStore";
import { FrontfillService } from "@/frontfill/FrontfillService";
import { ReloadService } from "@/reload/ReloadService";
import { ServerService } from "@/server/ServerService";

import { EventHandlerService } from "./eventHandler/EventHandlerService";

export type Resources = {
  options: PonderOptions;
  config: ResolvedPonderConfig;
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

    // When the process is killed, the Ponder instance attempts
    // to gracefully shutdown using the kill method before exiting.
    let isKilledListenerInProgress = false;
    const listener = async () => {
      if (isKilledListenerInProgress) return;
      isKilledListenerInProgress = true;
      await this.kill();
      process.exit(0);
    };
    process.on("SIGINT", listener); // CTRL+C
    process.on("SIGQUIT", listener); // Keyboard quit
    process.on("SIGTERM", listener); // `kill` command
  }

  setup() {
    this.reloadService.on("ponderConfigChanged", async () => {
      await this.kill();
    });

    this.reloadService.on("newSchema", async ({ schema, graphqlSchema }) => {
      this.serverService.reload({ graphqlSchema });
      this.eventHandlerService.resetEventQueue({ schema });

      // this.codegenService.generateGraphqlTypes({ graphqlSchema })
    });

    this.reloadService.on("newHandlers", async ({ handlers }) => {
      this.eventHandlerService.resetEventQueue({ handlers });

      // this.codegenService.generateHandlerTypes({ graphqlSchema })
    });
  }

  async kill() {
    await this.reloadService.kill?.();
    this.frontfillService.killQueues();
    this.backfillService.killQueues();
    this.eventHandlerService.killQueue();
    await this.serverService.teardown();
    await this.resources.entityStore.teardown();
  }
}
