import { type Hash, type RpcBlock, hexToNumber, RpcTransaction } from "viem";

import { Prettify } from "@/types/utils";

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

export type BlockWithTransactions = Prettify<
  Omit<RpcBlock, "hash" | "transactions"> & {
    hash: Hash;
    number: Hash;
    transactions: RpcTransaction[];
  }
>;
