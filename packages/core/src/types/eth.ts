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
  /** Globally unique identifier for this log (`${blockHash}-${logIndex}`) */
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
  /** `true` if this log has been removed in a chain reorganization */
  removed: boolean;
  /** List of order-dependent topics */
  topics: [Hex, ...Hex[]] | [];
  /** Hash of the transaction that created this log */
  transactionHash: Hash;
  /** Index of the transaction that created this log */
  transactionIndex: number;
};

/**
 * A confirmed Ethereum transaction receipt.
 */
export type TransactionReceipt = {
  /** Hash of block containing this transaction */
  blockHash: Hash;
  /** Number of block containing this transaction */
  blockNumber: bigint;
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
  /** List of log objects generated by this transaction */
  logs: Log[];
  /** Logs bloom filter */
  logsBloom: Hex;
  /** `success` if this transaction was successful or `reverted` if it failed */
  status: "success" | "reverted";
  /** Transaction recipient or `null` if deploying a contract */
  to: Address | null;
  /** Hash of this transaction */
  transactionHash: Hash;
  /** Index of this transaction in the block */
  transactionIndex: number;
  /** Transaction type */
  type: TransactionType;
};

type _TraceAddress = number | _TraceAddress[];
type TraceAddress = _TraceAddress[];

/**
 * An Ethereum call trace.
 */
export type CallTrace = {
  /** Globally unique identifier for this trace (`${transactionHash}-${traceAddress}`) */
  id: string;
  /** Message sender */
  from: Address;
  /** Message receipient  */
  to: Address;
  /** Amount of gas allocated to this call */
  gas: bigint;
  /** Value in wei sent with this call */
  value: bigint;
  /** Calldata sent with this call */
  input: Hex;
  /** Contains return data */
  output: Hex;
  /** Total used gas by this trace */
  gasUsed: bigint;
  /** Number of traces created by this trace */
  subtraces: number;
  /** Description of this traces position within all traces in the transaction */
  traceAddress: TraceAddress;
  /** Hash of block containing this trace */
  blockHash: Hash;
  /** Number of block containing this trace */
  blockNumber: bigint;
  /** Hash of the transaction that created this trace */
  transactionHash: Hash;
  /** Index of the transaction that created this trace */
  transactionIndex: number;
  /** EVM opcode used to make this call */
  callType: "call" | "staticcall" | "delegatecall" | "callcode";
};
