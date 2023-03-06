import { mine } from "viem/test";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { FrontfillService } from "@/frontfill/FrontfillService";

import BaseRegistrarImplementationAbi from "./abis/BaseRegistrarImplementation.abi.json";
import { buildTestResources } from "./resources";
import { setup, testClient } from "./utils/clients";

describe("FrontfillService", () => {
  let frontfillService: FrontfillService;

  beforeEach(async () => {
    await setup();

    const resources = await buildTestResources({
      contracts: [
        {
          name: "BaseRegistrarImplementation",
          network: "mainnet",
          abi: BaseRegistrarImplementationAbi,
          address: "0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85",
          startBlock: 16370000,
        },
      ],
    });

    frontfillService = new FrontfillService({ resources });
  });

  afterEach(() => {
    frontfillService.killQueues();
  });

  test("getLatestBlockNumbers", async () => {
    const networkConnectedEvents = frontfillService.events("networkConnected");

    await frontfillService.getLatestBlockNumbers();

    await networkConnectedEvents.next().then(({ value }) => {
      expect(value).toEqual({
        network: "mainnet",
        blockNumber: 16380000,
        blockTimestamp: 1673397071,
      });
      networkConnectedEvents.return?.();
    });

    expect(frontfillService.backfillCutoffTimestamp).toBe(1673397071);
  });

  test("startFrontfill", async () => {
    const taskAddedEvents = frontfillService.events("taskAdded");
    const taskCompletedEvents = frontfillService.events("taskCompleted");

    await frontfillService.getLatestBlockNumbers();
    frontfillService.startFrontfill();

    await testClient.mine({ blocks: 1 });
    // ethers.provider.on("block", listener) doesn't seem to fire twice unless this is here
    await new Promise((r) => setTimeout(r));
    await testClient.mine({ blocks: 1 });

    await taskAddedEvents
      .next()
      .then(({ value }) => {
        expect(value).toEqual({
          network: "mainnet",
          blockNumber: 16380001,
        });
        return taskAddedEvents.next();
      })
      .then(({ value }) => {
        expect(value).toEqual({
          network: "mainnet",
          blockNumber: 16380002,
        });

        return taskAddedEvents.return?.();
      });

    await taskCompletedEvents
      .next()
      .then(({ value }) => {
        expect(value).toEqual({
          network: "mainnet",
          blockNumber: 16380001,
          blockTimestamp: 1673397072,
          blockTxCount: 0,
          matchedLogCount: 0,
        });
        return taskCompletedEvents.next();
      })
      .then(({ value }) => {
        expect(value).toEqual({
          network: "mainnet",
          blockNumber: 16380002,
          blockTimestamp: 1673397073,
          blockTxCount: 0,
          matchedLogCount: 0,
        });
        return taskCompletedEvents.return?.();
      });
  });
});
