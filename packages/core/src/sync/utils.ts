import type {
  Chain,
  Event,
  LightBlock,
  SyncBlock,
  SyncBlockHeader,
} from "@/internal/types.js";
import {
  type Checkpoint,
  MAX_CHECKPOINT,
  ZERO_CHECKPOINT,
  encodeCheckpoint,
} from "@/utils/checkpoint.js";
import { type Hash, hexToBigInt, hexToNumber } from "viem";
import type { SyncProgress } from "./sync.js";

/**
 * Returns true if all filters have a defined end block and the current
 * sync progress has reached the final end block.
 */
export const isSyncEnd = (syncProgress: SyncProgress) => {
  if (syncProgress.end === undefined || syncProgress.current === undefined) {
    return false;
  }

  return (
    hexToNumber(syncProgress.current.number) >=
    hexToNumber(syncProgress.end.number)
  );
};

/** Returns true if sync progress has reached the finalized block. */
export const isSyncFinalized = (syncProgress: SyncProgress) => {
  if (syncProgress.current === undefined) {
    return false;
  }

  return (
    hexToNumber(syncProgress.current.number) >=
    hexToNumber(syncProgress.finalized.number)
  );
};

/** Returns the closest-to-tip block that is part of the historical sync. */
export const getHistoricalLast = (
  syncProgress: Pick<SyncProgress, "finalized" | "end">,
) => {
  return syncProgress.end === undefined
    ? syncProgress.finalized
    : hexToNumber(syncProgress.end.number) >
        hexToNumber(syncProgress.finalized.number)
      ? syncProgress.finalized
      : syncProgress.end;
};

export const splitEvents = (
  events: Event[],
): { events: Event[]; chainId: number; checkpoint: string }[] => {
  let hash: Hash | undefined;
  const result: { events: Event[]; chainId: number; checkpoint: string }[] = [];

  for (const event of events) {
    if (hash === undefined || hash !== event.event.block.hash) {
      result.push({
        events: [],
        chainId: event.chainId,
        checkpoint: encodeCheckpoint({
          ...MAX_CHECKPOINT,
          blockTimestamp: event.event.block.timestamp,
          chainId: BigInt(event.chainId),
          blockNumber: event.event.block.number,
        }),
      });
      hash = event.event.block.hash;
    }

    result[result.length - 1]!.events.push(event);
  }

  return result;
};

/**
 * Returns the checkpoint for a given block tag.
 */
export const getChainCheckpoint = <
  tag extends "start" | "current" | "finalized" | "end",
>({
  syncProgress,
  chain,
  tag,
}: {
  syncProgress: SyncProgress;
  chain: Chain;
  tag: tag;
}): tag extends "end" ? string | undefined : string => {
  if (tag === "end" && syncProgress.end === undefined) {
    return undefined as tag extends "end" ? string | undefined : string;
  }

  // Note: `current` is guaranteed to be defined because it is only used once the historical
  // backfill is complete.
  const block = syncProgress[tag]!;
  return encodeCheckpoint(
    blockToCheckpoint(
      block,
      chain.id,
      // The checkpoint returned by this function is meant to be used in
      // a closed interval (includes endpoints), so "start" should be inclusive.
      tag === "start" ? "down" : "up",
    ),
  ) as tag extends "end" ? string | undefined : string;
};

export const syncBlockToLightBlock = ({
  hash,
  parentHash,
  number,
  timestamp,
}: SyncBlock | SyncBlockHeader): LightBlock => ({
  hash,
  parentHash,
  number,
  timestamp,
});

/** Convert `block` to a `Checkpoint`. */
export const blockToCheckpoint = (
  block: LightBlock | SyncBlock,
  chainId: number,
  rounding: "up" | "down",
): Checkpoint => {
  return {
    ...(rounding === "up" ? MAX_CHECKPOINT : ZERO_CHECKPOINT),
    blockTimestamp: hexToBigInt(block.timestamp),
    chainId: BigInt(chainId),
    blockNumber: hexToBigInt(block.number),
  };
};
