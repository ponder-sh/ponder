import type { AccessList, Address, Hash, Hex } from "viem";

import type { Prettify } from "./utils.js";

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
        maxFeePerGas: bigint | undefined;
        /** Max priority fee per gas (in wei). Only present in EIP-1559 transactions. */
        maxPriorityFeePerGas: bigint | undefined;
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
