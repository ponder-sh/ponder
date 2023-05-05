import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { FrontfillService } from "@/frontfill/FrontfillService";

import { accounts, usdcContractConfig, vitalik } from "../utils/constants";
import { expectEvents } from "../utils/expectEvents";
import { buildTestResources } from "../utils/resources";
import { testClient, walletClient } from "../utils/utils";

beforeEach(async () => {
  await testClient.impersonateAccount({
    address: vitalik.address,
  });
  await testClient.setAutomine(true);
});

describe("FrontfillService", () => {
  let frontfillService: FrontfillService;

  beforeEach(async () => {
    const resources = await buildTestResources({
      contracts: [
        {
          name: "USDC",
          network: "mainnet",
          ...usdcContractConfig,
          startBlock: 16370000,
        },
      ],
    });

    frontfillService = new FrontfillService({ resources });
  });

  afterEach(async () => {
    await frontfillService.kill();
  });

  test("getLatestBlockNumbers()", async () => {
    const eventIterator = frontfillService.anyEvent();

    await frontfillService.getLatestBlockNumbers();

    await expectEvents(eventIterator, {
      networkConnected: 1,
    });

    expect(frontfillService.backfillCutoffTimestamp).toBe(1673397071);
  });

  test(
    "startFrontfill()",
    async () => {
      await frontfillService.getLatestBlockNumbers();

      const eventIterator1 = frontfillService.anyEvent();

      frontfillService.startFrontfill();

      await walletClient.writeContract({
        ...usdcContractConfig,
        functionName: "transfer",
        args: [accounts[0].address, 1n],
        account: vitalik.account,
      });
      await frontfillService.nextBatchesIdle();

      await expectEvents(eventIterator1, {
        frontfillStarted: 1,
        logTasksAdded: 1,
        logTaskCompleted: 1,
        logTaskFailed: 0,
        blockTasksAdded: 1,
        blockTaskCompleted: 1,
        blockTaskFailed: 0,
        eventsAdded: 1,
      });

      const eventIterator2 = frontfillService.anyEvent();
      const emitSpy = vi.spyOn(frontfillService, "emit");

      await walletClient.writeContract({
        ...usdcContractConfig,
        functionName: "transfer",
        args: [accounts[0].address, 1n],
        account: vitalik.account,
      });
      await walletClient.writeContract({
        ...usdcContractConfig,
        functionName: "transfer",
        args: [accounts[0].address, 1n],
        account: vitalik.account,
      });
      await frontfillService.nextBatchesIdle();

      await expectEvents(eventIterator2, {
        frontfillStarted: 0,
        logTasksAdded: 1,
        logTaskCompleted: 1,
        logTaskFailed: 0,
        blockTasksAdded: 2,
        blockTaskCompleted: 2,
        blockTaskFailed: 0,
        eventsAdded: 2,
      });

      expect(emitSpy).toHaveBeenCalledWith("logTaskCompleted", {
        network: "mainnet",
        logData: {
          16380002: {
            [usdcContractConfig.address]: 1,
          },
          16380003: {
            [usdcContractConfig.address]: 1,
          },
        },
      });
    },
    {
      timeout: 10_000,
    }
  );
});
