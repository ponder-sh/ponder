import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";

import {
  BackfillService,
  BackfillServiceEvents,
} from "@/backfill/BackfillService";

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

  describe("backfill()", async () => {
    test("events are emitted", async () => {
      const eventIterator = backfillService.anyEvent();

      await backfillService.backfill();

      await expectEvents<BackfillServiceEvents>(eventIterator, [
        {
          name: "contractStarted",
          value: { contract: "USDC", cacheRate: 0 },
        },
        ...Array(6).fill({
          name: "logTasksAdded",
          value: { count: 1 },
        }),
        // There are a bunch of blockTasksAdded and blockTaskCompleted
        // events here in a non-deterministic order
        ...Array(6).fill({
          name: "logTaskCompleted",
          value: { contract: "USDC" },
        }),
        {
          name: "backfillCompleted",
          value: {},
        },
      ]);
    });

    describe("data is written to the cache store", () => {
      beforeEach(async () => {
        await backfillService.backfill();
      });

      test("logs, blocks, and transactions", async () => {
        const logs = await backfillService.resources.cacheStore.getLogs({
          contractAddress: usdcContractConfig.address,
          fromBlockTimestamp: 0,
          toBlockTimestamp: 1673276423,
        });

        expect(logs).toHaveLength(726);

        for (const log of logs) {
          const block = await backfillService.resources.cacheStore.getBlock(
            log.blockHash
          );
          expect(block).toBeTruthy();

          const transaction =
            await backfillService.resources.cacheStore.getTransaction(
              log.transactionHash
            );
          expect(transaction).toBeTruthy();
        }
      });

      test("cached interval", async () => {
        const cachedInterval =
          await backfillService.resources.cacheStore.getCachedIntervals(
            usdcContractConfig.address
          );

        expect(cachedInterval).toMatchObject([
          {
            id: 1,
            contractAddress: usdcContractConfig.address,
            startBlock: 16369950,
            endBlock: 16370000,
            endBlockTimestamp: 1673276423,
          },
        ]);
      });
    });
  });
});
