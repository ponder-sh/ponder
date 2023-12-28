import { setupAnvil, setupSyncStore } from "@/_test/setup.js";
import { simulate } from "@/_test/simulate.js";
import { getNetworks, publicClient } from "@/_test/utils.js";
import { startClock } from "@/utils/timer.js";
import { beforeEach, test } from "vitest";
import { HistoricalSyncService } from "./service.js";

beforeEach((context) => setupAnvil(context));
beforeEach((context) => setupSyncStore(context));

const getBlockNumbers = () =>
  publicClient.getBlockNumber().then((b) => ({
    latestBlockNumber: Number(b) + 5,
    finalizedBlockNumber: Number(b),
  }));

test.skipIf(process.env.CI === "true")(
  "Historical sync benchmark",
  async ({ erc20, factory, common, syncStore, sources }) => {
    for (let i = 0; i < 100; i++)
      await simulate({
        erc20Address: erc20.address,
        factoryAddress: factory.address,
      });

    const service = new HistoricalSyncService({
      common,
      syncStore,
      network: (await getNetworks(20))[0],
      sources: [sources[0]],
    });

    const stopClock = startClock();

    await service.start(await getBlockNumbers());

    await new Promise<void>((resolve) => service.on("syncComplete", resolve));

    console.log(`Historical sync took ${stopClock()} milliseconds`);
  },
  10_000,
);
