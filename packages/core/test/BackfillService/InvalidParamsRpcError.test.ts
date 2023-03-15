import { InvalidParamsRpcError, PublicClientConfig, RpcError } from "viem";
import { afterEach, beforeAll, beforeEach, describe, test, vi } from "vitest";

import { BackfillService } from "@/backfill/BackfillService";

import { testClient } from "../utils/clients";
import { usdcContractConfig } from "../utils/constants";
import { expectEvents } from "../utils/expectEvents";
import { buildTestResources } from "../utils/resources";

beforeAll(async () => {
  await testClient.reset({
    blockNumber: BigInt(parseInt(process.env.ANVIL_BLOCK_NUMBER!)),
    jsonRpcUrl: process.env.ANVIL_FORK_URL,
  });
});

// This will throw the error only the first time publicClient.getLogs()
// is called. Ideally this would be controlled more granularly, but
// not sure how to do it using vitest.
vi.mock("viem", async (importActual) => {
  const viem = await importActual<typeof import("viem")>();
  return {
    ...viem,
    createPublicClient: (config: PublicClientConfig) => {
      const publicClient = viem.createPublicClient(config);
      return {
        ...publicClient,
        getLogs: vi.fn(publicClient.getLogs).mockRejectedValueOnce(
          new InvalidParamsRpcError(
            new RpcError({
              body: {},
              error: {
                code: -32602,
                // The suggested block range is 16369950 to 16369955.
                message:
                  "Log response size exceeded. this block range should work: [0xf9c91e, 0xf9c923]",
              },
              url: "",
            })
          )
        ),
      };
    },
  };
});

describe("InvalidParamsRpcError", () => {
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
  });

  describe("backfill()", () => {
    test("events are emitted", async () => {
      const eventIterator = backfillService.anyEvent();

      await backfillService.backfill();

      await expectEvents(eventIterator, {
        contractStarted: 1,
        backfillStarted: 1,
        logTasksAdded: 8, // 2 more than normal
        logTaskCompleted: 7, // 1 more than normal
        logTaskFailed: 1, // 1 more than normal
        blockTasksAdded: 52, // 1 more than normal
        blockTaskCompleted: 52, // 1 more than normal
        blockTaskFailed: 0,
        backfillCompleted: 1,
        newEventsAdded: 7, // 1 more than normal
      });
    });

    // TODO: Ideally, add tests to confirm that data has been written to the cache
    // store (like in normal.test.ts). Must solve the mocking issue described above first.
  });
});
