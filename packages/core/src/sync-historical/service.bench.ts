import {
  setupAnvil,
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { simulate } from "@/_test/simulate.js";
import { publicClient } from "@/_test/utils.js";
import type { SyncStore } from "@/sync-store/store.js";
import { type TestContext, bench } from "vitest";
import { HistoricalSyncService } from "./service.js";

let context = {} as TestContext;
let syncStore = {} as SyncStore;
let cleanup = async () => {};

const setup = async () => {
  context = {} as TestContext;
  setupCommon(context);
  await setupAnvil(context);
  const teardownDatabase = await setupIsolatedDatabase(context);
  const { syncStore: syncStore_, cleanup: cleanupSyncStore } =
    await setupDatabaseServices(context);
  syncStore = syncStore_;

  cleanup = async () => {
    await teardownDatabase();
    await cleanupSyncStore();
  };

  for (let i = 0; i < 100; i++)
    await simulate({
      erc20Address: context.erc20.address,
      factoryAddress: context.factory.address,
    });
};

const teardown = async () => {
  await cleanup();
};

const getBlockNumbers = () =>
  publicClient.getBlockNumber().then((b) => ({
    latestBlockNumber: Number(b) + 5,
    finalizedBlockNumber: Number(b),
  }));

bench(
  "Historical sync benchmark",
  async () => {
    const service = new HistoricalSyncService({
      common: context.common,
      syncStore: syncStore,
      network: context.networks[0],
      requestQueue: context.requestQueues[0],
      sources: [context.sources[0]],
    });

    await service.setup(await getBlockNumbers());

    service.start();

    await new Promise<void>((resolve) => service.on("syncComplete", resolve));
  },
  {
    setup,
    teardown,
    iterations: 5,
    warmupIterations: 1,
    time: 10_000,
    warmupTime: 10_000,
  },
);
