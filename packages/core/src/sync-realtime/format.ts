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
export type LightLog = Pick<
  Log<number, Hex, false>,
  "blockHash" | "blockNumber" | "transactionHash" | "logIndex"
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

export const syncLogToLightLog = ({
  blockHash,
  blockNumber,
  transactionHash,
  logIndex,
}: SyncLog): LightLog => ({
  blockHash,
  blockNumber: hexToNumber(blockNumber),
  transactionHash,
  logIndex,
});

export const sortLogs = <log extends SyncLog | LightLog>(
  logs: log[],
): log[] => {
  return logs.sort((a, b) => {
    if (a.blockNumber < b.blockNumber) return -1;
    if (a.blockNumber > b.blockNumber) return 1;
    if (a.logIndex < b.logIndex) return -1;
    if (a.logIndex > b.logIndex) return 1;
    return 0;
  });
};
