import type { Address, Hash, Hex } from "viem";

/**
 * A confirmed Ethereum log.
 *
 * @link https://docs.soliditylang.org/en/v0.8.20/abi-spec.html#events
 */
export type Log = {
  /** Globally unique identifier for this log (`${blockHash}-${logIndex}`). */
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
