import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";

import { BackfillService } from "@/backfill/BackfillService";

import { testClient } from "../utils/clients";
import { usdcContractConfig } from "../utils/constants";
import { expectEvents } from "../utils/expectEvents";
import { resetCacheStore } from "../utils/resetCacheStore";
import { buildTestResources } from "../utils/resources";

beforeAll(async () => {
  await testClient.reset({
    blockNumber: BigInt(parseInt(process.env.ANVIL_BLOCK_NUMBER!)),
    jsonRpcUrl: process.env.ANVIL_FORK_URL,
  });
});

describe("normal", () => {
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

  describe("backfill()", () => {
    test("events are emitted", async () => {
      const eventIterator = backfillService.anyEvent();

      await backfillService.backfill();

      await expectEvents(eventIterator, {
        contractStarted: 1,
        backfillStarted: 1,
        logTasksAdded: 6,
        logTaskCompleted: 6,
        logTaskFailed: 0,
        blockTasksAdded: 51,
        blockTaskCompleted: 51,
        blockTaskFailed: 0,
        backfillCompleted: 1,
        newEventsAdded: 6,
      });
    });

    test("logs, blocks, and transactions are written to cache store", async () => {
      await backfillService.backfill();

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

    test("cached interval is written to cache store", async () => {
      await backfillService.backfill();

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
