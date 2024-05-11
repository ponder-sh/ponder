import type { SyncBlock, SyncLog } from "@/sync/index.js";
import {
  type Block,
  type BlockTag,
  type Hex,
  type Log,
  hexToNumber,
} from "viem";

export type LightBlock = Pick<
  Block<number, boolean, Exclude<BlockTag, "pending">>,
  "hash" | "parentHash" | "number" | "timestamp" | "logsBloom"
>;

export const syncBlockToLightBlock = ({
  hash,
  parentHash,
  number,
  timestamp,
  logsBloom,
}: SyncBlock): LightBlock => ({
  hash,
  parentHash,
  number: hexToNumber(number),
  timestamp: hexToNumber(timestamp),
  logsBloom,
});
