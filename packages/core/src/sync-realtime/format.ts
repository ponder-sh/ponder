import {
  type Hash,
  hexToNumber,
  type RpcBlock,
  type RpcTransaction,
} from "viem";

import type { Prettify } from "@/types/utils.js";

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
