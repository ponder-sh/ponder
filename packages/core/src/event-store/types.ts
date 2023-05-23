import { Generated, Insertable, Selectable } from "kysely";
import { AccessList, Address, Hash, Hex } from "viem";

import { Prettify } from "@/types/utils";

type InternalFields = {
  /** (Internal) Chain ID. */
  chainId: number;
  /** (Internal) Whether the block is past the finality threshold, 0 or 1. */
  finalized: number;
};

type ConfirmedBlockBase = {
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
  mixHash: Hash;
  /** Proof-of-work hash */
  nonce: Hex;
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

type BlocksTable = ConfirmedBlockBase & InternalFields;
export type InsertableBlock = Insertable<BlocksTable>;

/**
 * A confirmed Ethereum block.
 *
 * @link https://docs.soliditylang.org/en/v0.8.20/introduction-to-smart-contracts.html#blocks
 */
export type Block = Prettify<ConfirmedBlockBase>;

type ConfirmedTransactionFields = {
  /** Hash of block containing this transaction */
  blockHash: Hash;
  /** Number of block containing this transaction */
  blockNumber: bigint;
  /** Transaction sender */
  from: Address;
  /** Gas provided for transaction execution */
  gas: bigint;
  /** Hash of this transaction */
  hash: Hash;
  /** Contract code or a hashed method call */
  input: Hex;
  /** Unique number identifying this transaction */
  nonce: number;
  /** ECDSA signature r */
  r: Hex;
  /** ECDSA signature s */
  s: Hex;
  /** Transaction recipient or `null` if deploying a contract */
  to: Address | null;
  /** Index of this transaction in the block */
  transactionIndex: number;
  /** ECDSA recovery ID */
  v: bigint;
  /** Value in wei sent with this transaction */
  value: bigint;
};

type TransactionFeeValueFields = {
  /** Transaction type. */
  type: "legacy" | "eip2930" | "eip1559";
  /** Base fee per gas. Only present in legacy and EIP-2930 transactions. */
  gasPrice: bigint | null;
  /** Total fee per gas in wei (gasPrice/baseFeePerGas + maxPriorityFeePerGas). Only present in EIP-1559 transactions. */
  maxFeePerGas: bigint | null;
  /** Max priority fee per gas (in wei). Only present in EIP-1559 transactions. */
  maxPriorityFeePerGas: bigint | null;
  /** Max priority fee per gas (in wei). Persisted as stringified JSON. Only present in EIP-2930 transactions. */
  accessList: string | null;
};

type TransactionsTable = ConfirmedTransactionFields &
  TransactionFeeValueFields &
  InternalFields;
export type InsertableTransaction = Insertable<TransactionsTable>;

/**
 * A confirmed Ethereum transaction. Contains `legacy`, `EIP-1559`, or `EIP-2930` fee values depending on the transaction `type`.
 *
 * @link https://docs.soliditylang.org/en/v0.8.20/introduction-to-smart-contracts.html#transactions
 */
export type Transaction = Prettify<
  ConfirmedTransactionFields &
    (
      | {
          /** Transaction type. */
          type: "legacy";
          accessList?: never;
          /** Base fee per gas. Only present in legacy and EIP-2930 transactions. */
          gasPrice: bigint;
          maxFeePerGas?: never;
          maxPriorityFeePerGas?: never;
        }
      | {
          /** Transaction type. */
          type: "eip1559";
          accessList?: never;
          gasPrice?: never;
          /** Total fee per gas in wei (gasPrice/baseFeePerGas + maxPriorityFeePerGas). Only present in EIP-1559 transactions. */
          maxFeePerGas: bigint;
          /** Max priority fee per gas (in wei). Only present in EIP-1559 transactions. */
          maxPriorityFeePerGas: bigint;
        }
      | {
          /** Transaction type. */
          type: "eip2930";
          /** Base fee per gas. Only present in legacy and EIP-2930 transactions. */
          gasPrice: bigint;
          /** List of addresses and storage keys the transaction will access. */
          accessList: AccessList;
          maxFeePerGas?: never;
          maxPriorityFeePerGas?: never;
        }
    )
>;

type ConfirmedLogFields = {
  /** Globally unique identifier for this log. */
  id: string;
  /** The address from which this log originated */
  address: Address;
  /** Hash of block containing this log */
  blockHash: Hash;
  /** Number of block containing this log */
  blockNumber: bigint;
  /** Contains the non-indexed arguments of the log */
  data: Hex;
  /** Index of this log within its block */
  logIndex: number;
  /** Hash of the transaction that created this log */
  transactionHash: Hash;
  /** Index of the transaction that created this log */
  transactionIndex: number;
};

type InternalLogFields = {
  topic0: string | null;
  topic1: string | null;
  topic2: string | null;
  topic3: string | null;
};

type LogsTable = ConfirmedLogFields & InternalLogFields & InternalFields;
export type InsertableLog = Insertable<LogsTable>;

/**
 * A confirmed Ethereum log.
 *
 * @link https://docs.soliditylang.org/en/v0.8.20/abi-spec.html#events
 */
export type Log = Prettify<
  ConfirmedLogFields & {
    /** List of order-dependent topics */
    topics: [Hex, ...Hex[]] | [];
    /** `true` if this filter has been destroyed and is invalid */
    removed: boolean;
  }
>;

type ContractCallsTable = {
  address: string;
  blockNumber: bigint;
  chainId: number;
  data: string;
  finalized: number; // Boolean (0 or 1).
  id: string; // Primary key from `${chainId}-${blockNumber}-${address}-${data}`
  result: string;
};

type LogFilterCachedRangesTable = {
  id: Generated<number>;
  filterKey: string;
  startBlock: number;
  endBlock: number;
  endBlockTimestamp: number;
};

export type LogFilterCachedRange = Omit<
  Selectable<LogFilterCachedRangesTable>,
  "id"
>;

export type EventStoreTables = {
  blocks: BlocksTable;
  transactions: TransactionsTable;
  logs: LogsTable;
  contractCalls: ContractCallsTable;
  logFilterCachedRanges: LogFilterCachedRangesTable;
};
