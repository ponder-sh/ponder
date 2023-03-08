import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { BackfillService } from "@/backfill/BackfillService";

import BaseRegistrarImplementationAbi from "./abis/BaseRegistrarImplementation.abi.json";
import { setup } from "./utils/clients";
import { resetCacheStore } from "./utils/resetCacheStore";
import { buildTestResources } from "./utils/resources";

describe("BackfillService", () => {
  let backfillService: BackfillService;

  beforeEach(async () => {
    await setup();

    const resources = await buildTestResources({
      contracts: [
        {
          name: "BaseRegistrarImplementation",
          network: "mainnet",
          abi: BaseRegistrarImplementationAbi,
          address: "0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85",
          startBlock: 16369950,
          endBlock: 16370000,
          blockLimit: 10,
        },
      ],
    });

    backfillService = new BackfillService({ resources });
  });

  afterEach(async () => {
    backfillService.killQueues();

    await resetCacheStore(backfillService.resources.database);
  });

  test("backfill events", async () => {
    const contractStartedEvents = backfillService.events("contractStarted");
    const backfillCompletedEvents = backfillService.events("backfillCompleted");

    let logTaskCount = 0;
    backfillService.on("logTasksAdded", ({ count }) => {
      logTaskCount += count;
    });

    let blockTaskCount = 0;
    backfillService.on("blockTasksAdded", ({ count }) => {
      blockTaskCount += count;
    });

    await backfillService.backfill();

    expect(logTaskCount).toBe(5);
    expect(blockTaskCount).toBe(15);

    await contractStartedEvents.next().then(({ value }) => {
      expect(value).toEqual({
        contract: "BaseRegistrarImplementation",
        cacheRate: 0,
      });
      return contractStartedEvents.return?.();
    });

    await backfillCompletedEvents.next().then(({ value }) => {
      expect(value.duration).toBeGreaterThan(0);
      return backfillCompletedEvents.return?.();
    });
  });

  test("backfill data written to cache store", async () => {
    expect(backfillService.resources.cacheStore.getBlock("0x0"));

    await backfillService.backfill();
  });
});
