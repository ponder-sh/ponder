import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";

import {
  FrontfillService,
  FrontfillServiceEvents,
} from "@/frontfill/FrontfillService";

import { testClient, walletClient } from "./utils/clients";
import { accounts, usdcContractConfig, vitalik } from "./utils/constants";
import { expectEvents } from "./utils/expectEvents";
import { buildTestResources } from "./utils/resources";
import { wait } from "./utils/wait";

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
      contracts: [
        {
          name: "USDC",
          network: "mainnet",
          startBlock: 16370000,
          ...usdcContractConfig,
        },
      ],
    });

    frontfillService = new FrontfillService({ resources });
  });

  afterEach(() => {
    frontfillService.killQueues();
  });

  test("getLatestBlockNumbers", async () => {
    const eventIterator = frontfillService.anyEvent();

    await frontfillService.getLatestBlockNumbers();

    await expectEvents<FrontfillServiceEvents>(eventIterator, [
      {
        name: "networkConnected",
        value: {
          network: "mainnet",
          blockNumber: 16380000,
          blockTimestamp: 1673397071,
        },
      },
    ]);

    expect(frontfillService.backfillCutoffTimestamp).toBe(1673397071);
  });

  test(
    "startFrontfill",
    async () => {
      const eventIterator = frontfillService.anyEvent();

      await frontfillService.getLatestBlockNumbers();
      frontfillService.startFrontfill();

      await walletClient.writeContract({
        ...usdcContractConfig,
        functionName: "transfer",
        args: [accounts[0].address, 1n],
        account: vitalik.account,
      });
      await wait(1000);

      await expectEvents<FrontfillServiceEvents>(eventIterator, [
        {
          name: "networkConnected",
          value: {
            network: "mainnet",
            blockNumber: 16380000,
            blockTimestamp: 1673397071,
          },
        },
        {
          name: "logTasksAdded",
          value: { network: "mainnet", count: 1 },
        },
        {
          name: "blockTasksAdded",
          value: { network: "mainnet", count: 1 },
        },
        {
          name: "blockTaskCompleted",
          value: { network: "mainnet" },
        },
        {
          name: "eventsAdded",
          value: { count: 1 },
        },
        {
          name: "logTaskCompleted",
          value: { network: "mainnet" },
        },
      ]);

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
      await wait(1000);

      await expectEvents<FrontfillServiceEvents>(eventIterator, [
        {
          name: "logTasksAdded",
          value: { network: "mainnet", count: 1 },
        },
        {
          name: "blockTasksAdded",
          value: { network: "mainnet", count: 2 },
        },
        {
          name: "blockTaskCompleted",
          value: { network: "mainnet" },
        },
        {
          name: "blockTaskCompleted",
          value: { network: "mainnet" },
        },
        {
          name: "eventsAdded",
          value: { count: 2 },
        },
        {
          name: "logTaskCompleted",
          value: { network: "mainnet" },
        },
      ]);
    },
    {
      timeout: 10_000,
    }
  );
});
