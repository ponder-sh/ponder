import type {
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
  max,
  min,
} from "@/utils/checkpoint.js";
import { partition } from "@/utils/partition.js";
import { zipperMany } from "@/utils/zipper.js";
import { type Hash, hexToBigInt, hexToNumber } from "viem";
import type { Sync, SyncProgress } from "./index.js";

/**
 * Compute the checkpoint for a single chain.
 */
export const getMultichainCheckpoint = <
  tag extends "start" | "end" | "current" | "finalized",
>({
  perChainSync,
  tag,
  chainId,
}: {
  perChainSync: Map<number, Sync>;
  tag: tag;
  chainId: number;
}): tag extends "end" ? string | undefined : string => {
  const syncProgress = perChainSync.get(chainId)!.syncProgress;
  return getChainCheckpoint({ syncProgress, chainId, tag });
};

/**
 * Compute the checkpoint across all chains.
 */
export const getOmnichainCheckpoint = <
  tag extends "start" | "end" | "current" | "finalized",
>({
  perChainSync,
  tag,
}: { perChainSync: Map<number, Sync>; tag: tag }): tag extends "end"
  ? string | undefined
  : string => {
  const checkpoints = Array.from(perChainSync.entries()).map(
    ([chainId, { syncProgress }]) =>
      getChainCheckpoint({ syncProgress, chainId, tag }),
  );

  if (tag === "end") {
    if (checkpoints.some((c) => c === undefined)) {
      return undefined as tag extends "end" ? string | undefined : string;
    }
    // Note: `max` is used here because `end` is an upper bound.
    return max(...checkpoints) as tag extends "end"
      ? string | undefined
      : string;
  }

  // Note: extra logic is needed for `current` because completed chains
  // shouldn't be included in the minimum checkpoint. However, when all
  // chains are completed, the maximum checkpoint should be computed across
  // all chains.
  if (tag === "current") {
    const isComplete = Array.from(perChainSync.values()).map(
      ({ syncProgress }) => isSyncEnd(syncProgress),
    );
    if (isComplete.every((c) => c)) {
      return max(...checkpoints) as tag extends "end"
        ? string | undefined
        : string;
    }
    return min(
      ...checkpoints.filter((_, i) => isComplete[i] === false),
    ) as tag extends "end" ? string | undefined : string;
  }

  return min(...checkpoints) as tag extends "end" ? string | undefined : string;
};

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
  chainId,
  tag,
}: {
  syncProgress: SyncProgress;
  chainId: number;
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
      chainId,
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

export type EventGenerator = AsyncGenerator<{
  events: Event[];
  /**
   * Closest-to-tip checkpoint for each chain,
   * excluding chains that were not updated with this batch of events.
   */
  checkpoints: { chainId: number; checkpoint: string }[];
}>;

/**
 * Merges multiple event generators into a single generator while preserving
 * the order of events.
 *
 * @param generators - Generators to merge.
 * @returns A single generator that yields events from all generators.
 */
export async function* mergeAsyncGeneratorsWithEventOrder(
  generators: AsyncGenerator<{ events: Event[]; checkpoint: string }>[],
): EventGenerator {
  const results = await Promise.all(generators.map((gen) => gen.next()));

  while (results.some((res) => res.done !== true)) {
    const supremum = min(
      ...results.map((res) => (res.done ? undefined : res.value.checkpoint)),
    );

    const eventArrays: {
      events: Event[];
      chainId: number;
      checkpoint: string;
    }[] = [];

    for (const result of results) {
      if (result.done === false) {
        const [left, right] = partition(
          result.value.events,
          (event) => event.checkpoint <= supremum,
        );

        const event = left[left.length - 1];

        if (event) {
          eventArrays.push({
            events: left,
            chainId: event.chainId,
            checkpoint: event.checkpoint,
          });
        }

        result.value.events = right;
      }
    }

    const events = zipperMany(eventArrays.map(({ events }) => events)).sort(
      (a, b) => (a.checkpoint < b.checkpoint ? -1 : 1),
    );

    const index = results.findIndex(
      (res) => res.done === false && res.value.checkpoint === supremum,
    );

    const resultPromise = generators[index]!.next();
    if (events.length > 0) {
      const checkpoints = eventArrays.map(({ chainId, checkpoint }) => ({
        chainId,
        checkpoint,
      }));

      yield { events, checkpoints };
    }
    results[index] = await resultPromise;
  }
}
