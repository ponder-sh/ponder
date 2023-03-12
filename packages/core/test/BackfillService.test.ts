import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";

import { BackfillService } from "@/backfill/BackfillService";

import { testClient } from "./utils/clients";
import { usdcContractConfig } from "./utils/constants";
import { expectEvents } from "./utils/expectEvents";
import { resetCacheStore } from "./utils/resetCacheStore";
import { buildTestResources } from "./utils/resources";

beforeAll(async () => {
  await testClient.reset({
    blockNumber: BigInt(parseInt(process.env.ANVIL_BLOCK_NUMBER!)),
    jsonRpcUrl: process.env.ANVIL_FORK_URL,
  });
});

describe("BackfillService", () => {
  let backfillService: BackfillService;

  beforeEach(async () => {
    const resources = await buildTestResources({
      contracts: [
        {
          name: "USDC",
          network: "mainnet",
          ...usdcContractConfig,
          startBlock: 16369950,
          endBlock: 16370000,
          blockLimit: 10,
        },
      ],
    });

    backfillService = new BackfillService({ resources });
  });

  afterEach(async () => {
    await backfillService.kill();

    await resetCacheStore(backfillService.resources.database);
  });

  test("backfill events", async () => {
    const eventIterator = backfillService.anyEvent();

    let logTaskCount = 0;
    backfillService.on("logTasksAdded", ({ count }) => {
      logTaskCount += count;
    });

    let blockTaskCount = 0;
    backfillService.on("blockTasksAdded", ({ count }) => {
      blockTaskCount += count;
    });

    await backfillService.backfill();

    expect(logTaskCount).toBe(6);
    expect(blockTaskCount).toBe(51);

    await expectEvents(eventIterator, [
      {
        name: "contractStarted",
        value: { contract: "USDC", cacheRate: 0 },
      },
      ...Array(6).fill({
        name: "logTasksAdded",
        value: { count: 1 },
      }),
      // There are a bunch of blockTasksAdded, blockTaskCompleted, etc. here
      {
        name: "backfillCompleted",
        value: {},
      },
    ]);
  });

  test("backfill data written to cache store", async () => {
    await backfillService.backfill();

    expect(
      await backfillService.resources.cacheStore.getCachedIntervals(
        usdcContractConfig.address
      )
    ).toMatchObject([
      {
        id: 1,
        contractAddress: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
        startBlock: 16369950,
        endBlock: 16370000,
        endBlockTimestamp: 1673276423,
      },
    ]);
  });
});
