import { expect, test } from "bun:test";
import { toHex } from "viem";
import type { Chain } from "@/internal/types.js";
import {
  decodeCheckpoint,
  encodeCheckpoint,
  MAX_CHECKPOINT,
} from "@/utils/checkpoint.js";
import type { SyncProgress } from "./index.js";
import { getOmnichainCheckpoint } from "./omnichain.js";

/** A sync progress with the timestamp of each block equal to its number. */
const createSyncProgress = (
  chainId: number,
  blocks: { current?: number; finalized: number; end?: number },
) =>
  ({
    finalized: { number: toHex(blocks.finalized) },
    end: blocks.end === undefined ? undefined : { number: toHex(blocks.end) },
    isEnd: () =>
      blocks.current !== undefined &&
      blocks.end !== undefined &&
      blocks.current >= blocks.end,
    getCheckpoint: ({ tag }: { tag: "current" | "finalized" | "end" }) => {
      const number = blocks[tag];
      if (number === undefined) return undefined;
      return encodeCheckpoint({
        ...MAX_CHECKPOINT,
        blockTimestamp: BigInt(number),
        chainId: BigInt(chainId),
        blockNumber: BigInt(number),
      });
    },
  }) as SyncProgress;

const getFinalizedBlock = (
  ...syncProgresses: ReturnType<typeof createSyncProgress>[]
) => {
  const checkpoint = decodeCheckpoint(
    getOmnichainCheckpoint({
      perChainSync: new Map(
        syncProgresses.map((syncProgress, i) => [
          { id: i } as Chain,
          { syncProgress },
        ]),
      ),
      tag: "finalized",
    }),
  );
  return { chainId: checkpoint.chainId, blockNumber: checkpoint.blockNumber };
};

test("getOmnichainCheckpoint() finalized", () => {
  expect(
    getFinalizedBlock(
      createSyncProgress(1, { finalized: 100 }),
      createSyncProgress(10, { finalized: 80, end: 120 }),
    ),
  ).toMatchInlineSnapshot(`
    {
      "blockNumber": 80n,
      "chainId": 10n,
    }
  `);
});

test("getOmnichainCheckpoint() finalized excludes completed chains", () => {
  // Note: The end block of chain 10 is finalized before and after the backfill.
  expect(
    getFinalizedBlock(
      createSyncProgress(1, { finalized: 100 }),
      createSyncProgress(10, { finalized: 20, end: 15 }),
    ),
  ).toMatchInlineSnapshot(`
    {
      "blockNumber": 100n,
      "chainId": 1n,
    }
  `);
  expect(
    getFinalizedBlock(
      createSyncProgress(1, { finalized: 100 }),
      createSyncProgress(10, { current: 20, finalized: 20, end: 15 }),
    ),
  ).toMatchInlineSnapshot(`
    {
      "blockNumber": 100n,
      "chainId": 1n,
    }
  `);
});

test("getOmnichainCheckpoint() finalized includes a chain until its end block is finalized", () => {
  expect(
    getFinalizedBlock(
      createSyncProgress(1, { finalized: 100 }),
      createSyncProgress(10, { current: 30, finalized: 20, end: 30 }),
    ),
  ).toMatchInlineSnapshot(`
    {
      "blockNumber": 20n,
      "chainId": 10n,
    }
  `);
});

test("getOmnichainCheckpoint() finalized with all chains completed", () => {
  expect(
    getFinalizedBlock(
      createSyncProgress(1, { finalized: 100, end: 90 }),
      createSyncProgress(10, { finalized: 20, end: 15 }),
    ),
  ).toMatchInlineSnapshot(`
    {
      "blockNumber": 100n,
      "chainId": 1n,
    }
  `);
});
