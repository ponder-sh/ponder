import type { BlockTag, RpcBlock } from "viem";

export type RealtimeBlock = RpcBlock<Exclude<BlockTag, "pending">, true>;

export type LightBlock = Pick<
  RealtimeBlock,
  "hash" | "parentHash" | "number" | "timestamp"
>;

export const realtimeBlockToLightBlock = ({
  hash,
  parentHash,
  number,
  timestamp,
}: RealtimeBlock): LightBlock => ({
  hash,
  parentHash,
  number,
  timestamp,
});
