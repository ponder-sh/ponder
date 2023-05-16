import type {
  Block as ViemBlock,
  Hash,
  Hex,
  Log as ViemLog,
  Transaction as ViemTransaction,
} from "viem";

import type { Prettify } from "@/types/utils";

/**
 * Internal representation of a confirmed Ethereum block.
 */
export type InternalBlock = Prettify<
  Omit<
    ViemBlock,
    | "sealFields"
    | "transactions"
    | "uncles"
    | "hash"
    | "logsBloom"
    | "nonce"
    | "number"
  > & {
    /** Block hash */
    hash: Hash;
    /** Logs bloom filter */
    logsBloom: Hex;
    /** Proof-of-work hash */
    nonce: Hex;
    /** Block number */
    number: bigint;
  }
>;

/**
 * A confirmed Ethereum block.
 *
 * @link https://docs.soliditylang.org/en/v0.8.20/introduction-to-smart-contracts.html#blocks
 */
export type Block = Prettify<InternalBlock>;

/**
 * Internal representation of a confirmed Ethereum transaction.
 */
export type InternalTransaction = Prettify<
  Omit<
    ViemTransaction,
    "chainId" | "blockHash" | "blockNumber" | "transactionIndex"
  > & {
    /** Hash of block containing this transaction */
    blockHash: Hash;
    /** Number of block containing this transaction */
    blockNumber: bigint;
    /** Index of this transaction in the block */
    transactionIndex: number;
  }
>;

/**
 * A confirmed Ethereum transaction.
 *
 * @link https://docs.soliditylang.org/en/v0.8.20/introduction-to-smart-contracts.html#transactions
 */
export type Transaction = Prettify<InternalTransaction>;

/**
 * Internal representation of a confirmed Ethereum log.
 */
export type InternalLog = Prettify<
  Omit<
    ViemLog,
    | "blockHash"
    | "blockNumber"
    | "logIndex"
    | "transactionHash"
    | "transactionIndex"
    | "topics"
  > & {
    /** Hash of block containing this log */
    blockHash: Hash;
    /** Number of block containing this log */
    blockNumber: bigint;
    /** Index of this log within its block */
    logIndex: number;
    /** Hash of the transaction that created this log */
    transactionHash: Hash;
    /** Index of the transaction that created this log */
    transactionIndex: number;

    /** Globally unique identifier for this log */
    id: string;
    /** Chain ID */
    chainId: number;

    topic0: Hex | null;
    topic1: Hex | null;
    topic2: Hex | null;
    topic3: Hex | null;
  }
>;

/**
 * An Ethereum log.
 *
 * @link https://docs.soliditylang.org/en/v0.8.20/abi-spec.html#events
 */
export type Log = Prettify<
  Omit<InternalLog, "chainId" | "topic0" | "topic1" | "topic2" | "topic3"> & {
    /** List of order-dependent topics */
    topics: [Hex, ...Hex[]] | [];
  }
>;
