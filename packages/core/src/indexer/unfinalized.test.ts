import { expectEvents } from "test/utils/expectEvents";
import { createPublicClient, custom, Hex, numberToHex, RpcBlock } from "viem";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { range } from "@/utils/range";

import { UnfinalizedIndexerService } from "./unfinalized";

const buildBasicBlock = (number: number) => {
  return {
    number: numberToHex(number),
    hash: numberToHex(number),
    parentHash: number === 0 ? "0x0" : numberToHex(number - 1),
    transactions: [],
  };
};
const defaultBlocks = range(0, 100).map(buildBasicBlock);

const buildMockRequest = ({
  initialLatestBlockNumber,
  blocks,
}: {
  initialLatestBlockNumber: number;
  blocks: Partial<RpcBlock>[];
}) => {
  let currentBlockNumber = initialLatestBlockNumber;

  return (args: { method: string; params: any[] }) => {
    switch (args.method) {
      case "eth_getBlockByHash": {
        return blocks.find((b) => b.hash === args.params[0]);
      }
      case "eth_getBlockByNumber": {
        let blockNumber: Hex;
        if (args.params[0] === "latest") {
          blockNumber = numberToHex(currentBlockNumber);
          currentBlockNumber += 1;
        } else {
          blockNumber = args.params[0];
        }

        return blocks.find((b) => b.number === blockNumber);
      }
      case "eth_getLogs": {
        return [];
      }
      default: {
        throw new Error(`Unexpected RPC method call in test: ${args.method}`);
      }
    }
  };
};

describe("unfinalized indexer", () => {
  const mockRequest = vi.fn();

  const mockClient = createPublicClient({
    transport: custom({ request: mockRequest }),
  });

  beforeEach(() => {
    mockRequest.mockImplementation(
      buildMockRequest({
        initialLatestBlockNumber: 50,
        blocks: defaultBlocks,
      })
    );
  });

  describe("setup", async () => {
    test("finality block count is greater than latest block number (happy path)", async () => {
      const unfinalizedIndexer = new UnfinalizedIndexerService({
        logFilters: [],
        client: mockClient,
        finalityBlockCount: 10,
      });

      const { finalizedBlockNumber } = await unfinalizedIndexer.setup();
      expect(finalizedBlockNumber).toBe(40);
    });

    test("finality block count is less than latest block number", async () => {
      const unfinalizedIndexer = new UnfinalizedIndexerService({
        logFilters: [],
        client: mockClient,
        finalityBlockCount: 75,
      });

      const { finalizedBlockNumber } = await unfinalizedIndexer.setup();
      expect(finalizedBlockNumber).toBe(0);
    });
  });

  describe("start", async () => {
    test("setup was not completed successfully", async () => {
      const unfinalizedIndexer = new UnfinalizedIndexerService({
        logFilters: [],
        client: mockClient,
      });

      await expect(() => unfinalizedIndexer.start()).rejects.toThrowError(
        "Unable to start. Must call setup() method before start()."
      );
    });

    test("fetches all missing blocks between finalized and latest", async () => {
      const unfinalizedIndexer = new UnfinalizedIndexerService({
        logFilters: [],
        client: mockClient,
      });
      await unfinalizedIndexer.setup();

      const eventIterator = unfinalizedIndexer.anyEvent();

      unfinalizedIndexer.start();

      await expectEvents(eventIterator, {
        unfinalizedBlock: 11, // blocks 40 - 50 inclusive
      });

      await unfinalizedIndexer.kill();
    });

    // TODO: more tests
  });
});
