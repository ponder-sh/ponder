import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";

import { FrontfillService } from "@/frontfill/FrontfillService";

import { testClient, walletClient } from "../utils/clients";
import { accounts, usdcContractConfig, vitalik } from "../utils/constants";
import { expectEvents } from "../utils/expectEvents";
import { buildTestResources } from "../utils/resources";

beforeAll(async () => {
  await testClient.reset({
    blockNumber: BigInt(parseInt(process.env.ANVIL_BLOCK_NUMBER!)),
    jsonRpcUrl: process.env.ANVIL_FORK_URL,
  });

  await testClient.impersonateAccount({
    address: vitalik.address,
  });
  await testClient.setAutomine(true);
});

afterAll(async () => {
  await testClient.stopImpersonatingAccount({
    address: vitalik.address,
  });
  await testClient.setAutomine(false);
});

describe("FrontfillService", () => {
  let frontfillService: FrontfillService;

  beforeEach(async () => {
    const resources = await buildTestResources({
      networks: [
        {
          name: "mainnet",
          chainId: 1,
          rpcUrl: "http://127.0.0.1:8545",
          pollingInterval: 500,
        },
      ],
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
        eventsAdded: 1,
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
