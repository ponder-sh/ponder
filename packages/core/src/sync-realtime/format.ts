import {
  type Block,
  type BlockTag,
  type Hex,
  type Log,
  type RpcBlock,
  hexToNumber,
} from "viem";

export type RealtimeBlock = RpcBlock<Exclude<BlockTag, "pending">, true>;
export type RealtimeLog = Log<Hex, Hex, false>;

export type LightBlock = Pick<
  Block<number, boolean, Exclude<BlockTag, "pending">>,
  "hash" | "parentHash" | "number" | "timestamp"
>;
export type LightLog = Pick<
  Log<number, Hex, false>,
  "blockHash" | "blockNumber"
>;

export const realtimeBlockToLightBlock = ({
  hash,
  parentHash,
  number,
  timestamp,
}: RealtimeBlock): LightBlock => ({
  hash,
  parentHash,
  number: hexToNumber(number),
  timestamp: hexToNumber(timestamp),
});

export const realtimeLogToLightLog = ({
  blockHash,
  blockNumber,
}: RealtimeLog): LightLog => ({
  blockHash,
  blockNumber: hexToNumber(blockNumber),
});
