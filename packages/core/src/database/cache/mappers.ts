import { Hex } from "viem";

import { Block, Log, Transaction } from "../../common/types";

export type DatabaseBlock = Omit<Block, "totalDifficulty" | "baseFeePerGas"> & {
  totalDifficulty: string | null;
  baseFeePerGas: string;
  // TODO: properly reflect that 6 additional fields are being persisted as strings.
};

export function encodeBlock(block: Block): DatabaseBlock {
  return {
    ...block,

    // totalDifficulty can be too large for better-sqlite3 to accept as a bigint,
    // so must manually convert to string before passing it.
    totalDifficulty:
      block.totalDifficulty !== null ? block.totalDifficulty.toString() : null,

    // baseFeePerGas is null on some chains. It should probably be optional in the
    // database as well, actually.
    baseFeePerGas:
      block.totalDifficulty !== null ? block.totalDifficulty.toString() : "0x0",
  };
}

export function decodeBlock(block: DatabaseBlock): Block {
  return {
    ...block,

    // These fields are currently persisted as strings, and must
    // be manually converted back to bigints to match viem types.
    number: BigInt(block.number),
    timestamp: BigInt(block.timestamp),
    size: BigInt(block.size),
    gasLimit: BigInt(block.gasLimit),
    gasUsed: BigInt(block.gasUsed),
    baseFeePerGas:
      block.baseFeePerGas !== null ? BigInt(block.baseFeePerGas) : null,
    totalDifficulty:
      block.totalDifficulty !== null ? BigInt(block.totalDifficulty) : null,
  };
}

export type DatabaseTransaction = Omit<
  Transaction,
  "maxFeePerGas" | "maxPriorityFeePerGas" | "value"
> & {
  maxFeePerGas: bigint | null;
  maxPriorityFeePerGas: bigint | null;
  value: string;
};

export function encodeTransaction(
  transaction: Transaction
): DatabaseTransaction {
  return {
    ...transaction,

    // These fields can be undefined on the input object, but they need to be
    // defined as null for SQLite to handle them properly.
    maxFeePerGas: transaction.maxFeePerGas ?? null,
    maxPriorityFeePerGas: transaction.maxPriorityFeePerGas ?? null,

    // totalDifficulty can be too large for better-sqlite3 to accept as a bigint,
    // so must manually convert to string before passing it.
    value: transaction.value.toString(),
  };
}

export function decodeTransaction(
  transaction: DatabaseTransaction
): Transaction {
  return {
    ...(transaction as unknown as Transaction),

    // These fields are currently persisted as strings, and must
    // be manually converted back to bigints to match viem types.
    blockNumber: BigInt(transaction.blockNumber),
    value: BigInt(transaction.value),
    gas: BigInt(transaction.gas),

    // These fields are persisted as string | null, and must be
    // converted to bigint | undefined.
    gasPrice: transaction.gasPrice ? BigInt(transaction.gasPrice) : undefined,
    maxFeePerGas:
      transaction.maxFeePerGas !== null
        ? BigInt(transaction.maxFeePerGas)
        : undefined,
    maxPriorityFeePerGas:
      transaction.maxPriorityFeePerGas !== null
        ? BigInt(transaction.maxPriorityFeePerGas)
        : undefined,
  } as Transaction;
}

export type DatabaseLog = Omit<Log, "removed"> & {
  removed: number;
};

export function encodeLog(log: Log): DatabaseLog {
  return {
    ...log,
    removed: log.removed === true ? 1 : 0,
  };
}

export function decodeLog(log: DatabaseLog): Log {
  return {
    ...log,
    removed: log.removed === 1 ? true : false,
    topics: [log.topic0, log.topic1, log.topic2, log.topic3].filter(
      (t): t is Hex => t !== null
    ) as [Hex, ...Hex[]] | [],

    logSortKey: BigInt(log.logSortKey),
    blockNumber: BigInt(log.blockNumber),
    blockTimestamp:
      log.blockTimestamp !== null ? BigInt(log.blockTimestamp) : null,
  };
}
