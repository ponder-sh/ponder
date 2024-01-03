import { setupAnvil, setupContext, setupSyncStore } from "@/_test/setup.js";
import { simulate } from "@/_test/simulate.js";
import { getNetworks, publicClient } from "@/_test/utils.js";
import { type TestContext, bench } from "vitest";
import { HistoricalSyncService } from "./service.js";

let context = {} as TestContext;
const setup = async () => {
  context = {} as TestContext;
  setupContext(context);
  await setupAnvil(context);

  for (let i = 0; i < 100; i++)
    await simulate({
      erc20Address: context.erc20.address,
      factoryAddress: context.factory.address,
    });
};

const getBlockNumbers = () =>
  publicClient.getBlockNumber().then((b) => ({
    latestBlockNumber: Number(b) + 5,
    finalizedBlockNumber: Number(b),
  }));

bench(
  "Historical sync benchmark",
  async () => {
    const teardownSync = await setupSyncStore(context);

    const service = new HistoricalSyncService({
      common: context.common,
      syncStore: context.syncStore,
      network: (await getNetworks(context.common, 20))[0],
      sources: [context.sources[0]],
    });

    await service.start(await getBlockNumbers());

    await new Promise<void>((resolve) => service.on("syncComplete", resolve));

    await teardownSync();
  },
  {
    setup,
    iterations: 5,
    warmupIterations: 1,
    time: 10_000,
    warmupTime: 10_000,
  },
);
