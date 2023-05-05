import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { BackfillService } from "@/backfill/BackfillService";
import { encodeLogFilterKey } from "@/config/encodeLogFilterKey";

import { usdcContractConfig } from "../utils/constants";
import { expectEvents } from "../utils/expectEvents";
import { buildTestResources } from "../utils/resources";

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
          maxBlockRange: 10,
        },
      ],
    });

    backfillService = new BackfillService({ resources });
  });

  afterEach(async () => {
    await backfillService.kill();
  });

  describe("backfill()", () => {
    test("events are emitted", async () => {
      const eventIterator = backfillService.anyEvent();

      await backfillService.backfill();

      await expectEvents(eventIterator, {
        logFilterStarted: 1,
        backfillStarted: 1,
        logTasksAdded: 6,
        logTaskCompleted: 6,
        logTaskFailed: 0,
        blockTasksAdded: 51,
        blockTaskCompleted: 51,
        blockTaskFailed: 0,
        backfillCompleted: 1,
        eventsAdded: 51,
      });
    });

    test("logs, blocks, and transactions are written to cache store", async () => {
      await backfillService.backfill();

      const logs = await backfillService.resources.cacheStore.getLogs({
        chainId: 1,
        address: usdcContractConfig.address,
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

      const filterKey = encodeLogFilterKey({
        chainId: 1,
        address: usdcContractConfig.address.toLowerCase() as `0x${string}`,
        topics: undefined,
      });

      const ranges =
        await backfillService.resources.cacheStore.getLogFilterCachedRanges({
          filterKey,
        });

      expect(ranges.length).toBe(1);
      expect(ranges[0]).toMatchObject({
        filterKey,
        startBlock: 16369950,
        endBlock: 16370000,
        endBlockTimestamp: 1673276423,
      });
    });
  });
});
