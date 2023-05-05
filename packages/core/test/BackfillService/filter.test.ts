import { parseAbiItem } from "abitype";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { BackfillService } from "@/backfill/BackfillService";

import { usdcContractConfig } from "../utils/constants";
import { buildTestResources } from "../utils/resources";

describe("filter", () => {
  let backfillService: BackfillService;

  beforeEach(async () => {
    const resources = await buildTestResources({
      filters: [
        {
          name: "USDC",
          network: "mainnet",
          abi: usdcContractConfig.abi,
          filter: {
            event: parseAbiItem(
              "event Transfer(address indexed, address indexed, uint256)"
            ),
          },
          startBlock: 16370000,
          endBlock: 16370001,
        },
      ],
    });

    backfillService = new BackfillService({ resources });
  });

  afterEach(async () => {
    await backfillService.kill();
  });

  describe("backfill()", () => {
    test("logs, blocks, and transactions are written to cache store", async () => {
      await backfillService.backfill();

      const logFilter = backfillService.resources.logFilters[0];
      const logs = await backfillService.resources.cacheStore.getLogs({
        chainId: 1,
        topics: logFilter.filter.topics,
        fromBlockTimestamp: 0,
        toBlockTimestamp: 1673276435, // 16370001 mainnet timestamp
      });

      expect(logs).toHaveLength(576);

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

      const logFilter = backfillService.resources.logFilters[0];

      const ranges =
        await backfillService.resources.cacheStore.getLogFilterCachedRanges({
          filterKey: logFilter.filter.key,
        });

      expect(ranges.length).toBe(1);
      expect(ranges[0]).toMatchObject({
        filterKey: logFilter.filter.key,
        startBlock: 16370000,
        endBlock: 16370001,
        endBlockTimestamp: 1673276435,
      });
    });
  });
});
