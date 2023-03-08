import type {
  Block as ViemBlock,
  Hash,
  Hex,
  Log as ViemLog,
  Transaction as ViemTransaction,
} from "viem";

type FinalizedBlock<
  TIncludeTransactions extends "includeTransactions" | false = false
> = ViemBlock & {
  hash: Hash;
  logsBloom: Hex;
  nonce: Hex;
  number: bigint;
  transactions: TIncludeTransactions extends "includeTransactions"
    ? FinalizedTransaction[]
    : Hash[];
};
export type Block<
  TIncludeTransactions extends "includeTransactions" | false = false
> = FinalizedBlock<TIncludeTransactions>;

function isFinalizedBlock<
  TIncludeTransactions extends "includeTransactions" | false = false
>(block: ViemBlock): block is FinalizedBlock<TIncludeTransactions> {
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

type FinalizedTransaction = ViemTransaction & {
  blockHash: Hash;
  blockNumber: bigint;
  transactionIndex: number;
};
export type Transaction = FinalizedTransaction & {
  // These fields are derived from the raw log data and are used internally by Ponder.
  chainId: number;
};

function isFinalizedTransaction(
  transaction: ViemTransaction
): transaction is FinalizedTransaction {
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
        transactions.push(rawTransaction);
      } else {
        console.log({ rawTransaction });
      }
      return transactions;
    },
    []
  );
}

type FinalizedLog = ViemLog & {
  blockHash: Hash;
  blockNumber: bigint;
  logIndex: number;
  transactionHash: Hash;
  transactionIndex: number;
};

export type Log = FinalizedLog & {
  // These fields are derived from the raw log data and are used internally by Ponder.
  logId: `${Hash}-${number}`; // `${blockHash}-${logIndex}`
  logSortKey: bigint; // (blockNumber * 100000) + logIndex,
  blockTimestamp: bigint | null;
  topic0: Hex | null;
  topic1: Hex | null;
  topic2: Hex | null;
  topic3: Hex | null;
};

function isFinalizedLog(log: ViemLog): log is FinalizedLog {
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
