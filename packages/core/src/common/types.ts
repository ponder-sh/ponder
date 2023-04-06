import type {
  Block as ViemBlock,
  Hash,
  Hex,
  Log as ViemLog,
  Transaction as ViemTransaction,
} from "viem";

export type Model<T extends { id: string | number | bigint }> = {
  create: (options: { id: T["id"]; data: Omit<T, "id"> }) => Promise<T>;

  update: (options: {
    id: T["id"];
    data: Omit<Partial<T>, "id">;
  }) => Promise<T>;

  upsert: (options: {
    id: T["id"];
    create: Omit<T, "id">;
    update: Omit<Partial<T>, "id">;
  }) => Promise<T>;

  findUnique: (options: { id: T["id"] }) => Promise<T | null>;

  delete: (options: { id: T["id"] }) => Promise<boolean>;
};

export type Block = Omit<
  ViemBlock,
  "hash" | "logsBloom" | "nonce" | "number"
> & {
  /** Block hash */
  hash: Hash;
  /** Logs bloom filter */
  logsBloom: Hex;
  /** Proof-of-work hash */
  nonce: Hex;
  /** Block number */
  number: bigint;
};

function isFinalizedBlock(block: ViemBlock): block is Block {
  return !!(
    block.hash !== null &&
    block.logsBloom !== null &&
    block.nonce !== null &&
    block.number !== null
  );
}

export function parseBlock(block: ViemBlock) {
  return isFinalizedBlock(block) ? block : null;
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
  /** List of order-dependent topics */
  topics: Hex[];

  /** Globally unique identifier for this log */
  logId: `${Hash}-${number}`;
  /** Value used internally by Ponder to sort logs across networks */
  logSortKey: bigint;
  /** Chain ID */
  chainId: number;
  /** Unix timestamp of when the block containing this log was collated */
  blockTimestamp: bigint | null;

  // TODO: remove these from the public type.
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

export function parseLogs(
  rawLogs: ViemLog[],
  { chainId }: { chainId: number }
): Log[] {
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
        chainId: chainId,
      });
    }
    return logs;
  }, []);
}
