import { type Hash, type RpcBlock, hexToNumber } from "viem";

export type LightBlock = {
  hash: Hash;
  parentHash: Hash;
  number: number;
  timestamp: number;
};

export function rpcBlockToLightBlock(block: RpcBlock): LightBlock {
  return {
    hash: block.hash!,
    parentHash: block.parentHash,
    number: hexToNumber(block.number!),
    timestamp: hexToNumber(block.timestamp),
  };
}
