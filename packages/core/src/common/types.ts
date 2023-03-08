import type {
  Block as ViemBlock,
  Hash,
  Hex,
  Log as ViemLog,
  Transaction as ViemTransaction,
} from "viem";

export type Block<
  TIncludeTransactions extends "includeTransactions" | false = false
> = Omit<ViemBlock, "hash" | "logsBloom" | "nonce" | "number"> & {
  /** Block hash */
  hash: Hash;
  /** Logs bloom filter */
  logsBloom: Hex;
  /** Proof-of-work hash */
  nonce: Hex;
  /** Block number */
  number: bigint;
  transactions: TIncludeTransactions extends "includeTransactions"
    ? Transaction[]
    : Hash[];
};

function isFinalizedBlock<
  TIncludeTransactions extends "includeTransactions" | false = false
>(block: ViemBlock): block is Block<TIncludeTransactions> {
  return !!(
    block.hash !== null &&
    block.logsBloom !== null &&
    block.nonce !== null &&
    block.number !== null
  );
}

export function parseBlock<
  TIncludeTransactions extends "includeTransactions" | false = false
>(block: ViemBlock): Block<TIncludeTransactions> | null {
  return isFinalizedBlock<TIncludeTransactions>(block) ? block : null;
}

export type Transaction = Omit<
  ViemTransaction,
  "blockHash" | "blockNumber" | "transactionIndex"
> & {
  /** Hash of block containing this transaction */
  blockHash: Hash;
  /** Number of block containing this transaction */
  blockNumber: bigint;
  /** Index of this transaction in the block */
  transactionIndex: number;
};

function isFinalizedTransaction(transaction: ViemTransaction) {
  return !!(
    transaction.blockHash !== null &&
    transaction.blockNumber !== null &&
    transaction.transactionIndex !== null
  );
}

export function parseTransactions(
  rawTransactions: ViemTransaction[]
): Transaction[] {
  return rawTransactions.reduce<Transaction[]>(
    (transactions, rawTransaction) => {
      if (isFinalizedTransaction(rawTransaction)) {
        transactions.push(rawTransaction as Transaction);
      }
      return transactions;
    },
    []
  );
}

export type Log = Omit<
  ViemLog,
  | "blockHash"
  | "blockNumber"
  | "logIndex"
  | "transactionHash"
  | "transactionIndex"
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
  logId: `${Hash}-${number}`;
  /** Value used internally by Ponder to sort logs across networks */
  logSortKey: bigint;
  /** Unix timestamp of when the block containing this log was collated */
  blockTimestamp: bigint | null;
  topic0: Hex | null;
  topic1: Hex | null;
  topic2: Hex | null;
  topic3: Hex | null;
};

function isFinalizedLog(log: ViemLog): log is Log {
  return !!(
    log.blockHash !== null &&
    log.blockNumber !== null &&
    log.logIndex !== null &&
    log.transactionHash !== null &&
    log.transactionIndex !== null
  );
}

export function parseLogs(rawLogs: ViemLog[]): Log[] {
  return rawLogs.reduce<Log[]>((logs, rawLog) => {
    if (isFinalizedLog(rawLog)) {
      logs.push({
        ...rawLog,
        logId: `${rawLog.blockHash}-${rawLog.logIndex}`,
        logSortKey: rawLog.blockNumber * 100000n + BigInt(rawLog.logIndex),
        blockTimestamp: null,
        topic0: rawLog.topics[0] ? (rawLog.topics[0] as Hex) : null,
        topic1: rawLog.topics[1] ? (rawLog.topics[1] as Hex) : null,
        topic2: rawLog.topics[2] ? (rawLog.topics[2] as Hex) : null,
        topic3: rawLog.topics[3] ? (rawLog.topics[3] as Hex) : null,
      });
    }
    return logs;
  }, []);
}
