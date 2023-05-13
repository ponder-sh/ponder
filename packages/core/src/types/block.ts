import { Hash, Hex, hexToNumber, RpcBlock, RpcTransaction } from "viem";

export type LightBlock = {
  hash: Hex;
  parentHash: Hex;
  number: number;
};

export function rpcBlockToLightBlock(block: RpcBlock): LightBlock {
  return {
    hash: block.hash!,
    parentHash: block.parentHash,
    number: hexToNumber(block.number!),
  };
}

export type FullBlock = Omit<RpcBlock, "hash" | "transactions"> & {
  hash: Hash;
  number: Hash;
  transactions: RpcTransaction[];
};
