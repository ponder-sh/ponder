import type { AccessList, Address, Hash, Hex, TransactionType } from "viem";
import type { Prettify } from "./utils.js";

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
  sha3Uncles: Hash | null;
  /** Size of this block in bytes */
  size: bigint;
  /** Root of this block’s final state trie */
  stateRoot: Hash;
  /** Unix timestamp of when this block was collated */
  timestamp: bigint;
  /** Total difficulty of the chain until this block */
  totalDifficulty: bigint | null;
  /** Root of this block’s transaction trie */
  transactionsRoot: Hash;
};

/**
 * A confirmed Ethereum transaction. Contains `legacy`, `EIP-1559`, or `EIP-2930` fee values depending on the transaction `type`.
 *
 * @link https://docs.soliditylang.org/en/v0.8.20/introduction-to-smart-contracts.html#transactions
 */
export type Transaction = Prettify<
  {
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
    r: Hex | null;
    /** ECDSA signature s */
    s: Hex | null;
    /** Transaction recipient or `null` if deploying a contract */
    to: Address | null;
    /** Index of this transaction in the block */
    transactionIndex: number;
    /** ECDSA recovery ID */
    v: bigint | null;
    /** Value in wei sent with this transaction */
    value: bigint;
  } & (
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
        type: "eip2930";
        /** List of addresses and storage keys the transaction will access. */
        accessList: AccessList;
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
        type: "deposit";
        accessList?: never;
        gasPrice?: never;
        /** Total fee per gas in wei (gasPrice/baseFeePerGas + maxPriorityFeePerGas). Only present in EIP-1559 transactions. */
        maxFeePerGas?: bigint;
        /** Max priority fee per gas (in wei). Only present in EIP-1559 transactions. */
        maxPriorityFeePerGas?: bigint;
      }
    | {
        /** Transaction type. */
        type: Hex;
        gasPrice?: never;
        accessList?: never;
        maxFeePerGas?: never;
        maxPriorityFeePerGas?: never;
      }
  )
>;

/**
 * A confirmed Ethereum log.
 *
 * @link https://docs.soliditylang.org/en/v0.8.20/abi-spec.html#events
 */
export type Log = {
  /** The address from which this log originated */
  address: Address;
  /** Contains the non-indexed arguments of the log */
  data: Hex;
  /** Index of this log within its block */
  logIndex: number;
  /** `true` if this log has been removed in a chain reorganization */
  removed: boolean;
  /** List of order-dependent topics */
  topics: [Hex, ...Hex[]] | [];
};

/** A confirmed Ethereum transaction receipt. */
export type TransactionReceipt = {
  /** Address of new contract or `null` if no contract was created */
  contractAddress: Address | null;
  /** Gas used by this and all preceding transactions in this block */
  cumulativeGasUsed: bigint;
  /** Pre-London, it is equal to the transaction's gasPrice. Post-London, it is equal to the actual gas price paid for inclusion. */
  effectiveGasPrice: bigint;
  /** Transaction sender */
  from: Address;
  /** Gas used by this transaction */
  gasUsed: bigint;
  /** Logs bloom filter */
  logsBloom: Hex;
  /** `success` if this transaction was successful or `reverted` if it failed */
  status: "success" | "reverted";
  /** Transaction recipient or `null` if deploying a contract */
  to: Address | null;
  /** Transaction type */
  type: TransactionType;
};

export type Trace = {
  /** The type of the call. */
  type:
    | "CALL"
    | "CALLCODE"
    | "DELEGATECALL"
    | "STATICCALL"
    | "CREATE"
    | "CREATE2"
    | "SELFDESTRUCT";
  /** The address of that initiated the call. */
  from: Address;
  /** The address of the contract that was called. */
  to: Address | null;
  /** How much gas was left before the call. */
  gas: bigint;
  /** How much gas was used by the call. */
  gasUsed: bigint;
  /** Calldata input. */
  input: Hex;
  /** Output of the call, if any. */
  output?: Hex;
  /** Error message, if any. */
  error?: string;
  /** Why this call reverted, if it reverted. */
  revertReason?: string;
  /** Value transferred. */
  value: bigint | null;
  /** Index of this trace in the transaction. */
  traceIndex: number;
  /** Number of subcalls. */
  subcalls: number;
};

/** A native token transfer. */
export type Transfer = {
  /** The address that sent the transfer */
  from: Address;
  /** The address that received the transfer */
  to: Address;
  /** The amount of tokens transferred */
  value: bigint;
};
