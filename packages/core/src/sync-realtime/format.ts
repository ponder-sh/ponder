import type { SyncBlock } from "@/sync/index.js";
import { type Block, type BlockTag, hexToNumber } from "viem";

export type LightBlock = Pick<
  Block<number, boolean, Exclude<BlockTag, "pending">>,
  "hash" | "parentHash" | "number" | "timestamp"
>;

export const syncBlockToLightBlock = ({
  hash,
  parentHash,
  number,
  timestamp,
}: SyncBlock): LightBlock => ({
  hash,
  parentHash,
  number: hexToNumber(number),
  timestamp: hexToNumber(timestamp),
});
