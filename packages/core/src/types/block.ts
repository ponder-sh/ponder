import type { Address, Hash, Hex } from "viem";

/**
 * A confirmed Ethereum block.
 *
 * @link https://docs.soliditylang.org/en/v0.8.20/introduction-to-smart-contracts.html#blocks
 */
export type Block = {
  /** Base fee per gas */
  baseFeePerGas: bigint | null;
  /** Difficulty for this block */
  difficulty: bigint;
  /** "Extra data" field of this block */
  extraData: Hex;
  /** Maximum gas allowed in this block */
  gasLimit: bigint;
  /** Total used gas by all transactions in this block */
  gasUsed: bigint;
  /** Block hash */
  hash: Hash;
  /** Logs bloom filter */
  logsBloom: Hex;
  /** Address that received this block’s mining rewards */
  miner: Address;
  /** Unique identifier for the block. */
  mixHash: Hash | null;
  /** Proof-of-work hash */
  nonce: Hex | null;
  /** Block number */
  number: bigint;
  /** Parent block hash */
  parentHash: Hash;
  /** Root of the this block’s receipts trie */
  receiptsRoot: Hex;
  /** SHA3 of the uncles data in this block */
  sha3Uncles: Hash;
  /** Size of this block in bytes */
  size: bigint;
  /** Root of this block’s final state trie */
  stateRoot: Hash;
  /** Unix timestamp of when this block was collated */
  timestamp: bigint;
  /** Total difficulty of the chain until this block */
  totalDifficulty: bigint;
  /** Root of this block’s transaction trie */
  transactionsRoot: Hash;
};
