import type {
  FragmentId,
  SyncBlock,
  SyncLog,
  SyncTrace,
  SyncTransaction,
  SyncTransactionReceipt,
} from "@/internal/types.js";
import type { ColumnType, Insertable } from "kysely";
import { hexToNumber } from "viem";

type BlocksTable = {
  chain_id: number;
  number: number;
  body: SyncBlock;
};

export const encodeBlock = ({
  block,
  chainId,
}: { block: SyncBlock; chainId: number }): Insertable<BlocksTable> => ({
  chain_id: chainId,
  number: hexToNumber(block.number),
  body: block,
});

type LogsTable = {
  chain_id: number;
  block_number: number;
  log_index: number;
  // TODO(kyle) transaction_index: number;
  body: SyncLog;
};

export const encodeLog = ({
  log,
  chainId,
}: { log: SyncLog; chainId: number }): Insertable<LogsTable> => ({
  chain_id: chainId,
  block_number: hexToNumber(log.blockNumber),
  log_index: hexToNumber(log.logIndex),
  // transaction_index: hexToNumber(log.transactionIndex),
  body: log,
});

type TransactionsTable = {
  chain_id: number;
  block_number: number;
  transaction_index: number;
  body: SyncTransaction;
};

export const encodeTransaction = ({
  transaction,
  chainId,
}: {
  transaction: SyncTransaction;
  chainId: number;
}): Insertable<TransactionsTable> => ({
  chain_id: chainId,
  block_number: hexToNumber(transaction.blockNumber),
  transaction_index: hexToNumber(transaction.transactionIndex),
  body: transaction,
});

type TransactionReceiptsTable = {
  chain_id: number;
  block_number: number;
  transaction_index: number;
  body: SyncTransactionReceipt;
};

export const encodeTransactionReceipt = ({
  transactionReceipt,
  chainId,
}: {
  transactionReceipt: SyncTransactionReceipt;
  chainId: number;
}): Insertable<TransactionReceiptsTable> => ({
  chain_id: chainId,
  block_number: hexToNumber(transactionReceipt.blockNumber),
  transaction_index: hexToNumber(transactionReceipt.transactionIndex),
  body: transactionReceipt,
});

type TracesTable = {
  chain_id: number;
  block_number: number;
  transaction_index: number;
  trace_index: number;
  body: SyncTrace;
};

export const encodeTrace = ({
  trace,
  block,
  transaction,
  chainId,
}: {
  trace: SyncTrace;
  block: Pick<SyncBlock, "number">;
  transaction: Pick<SyncTransaction, "transactionIndex">;
  chainId: number;
}): Insertable<TracesTable> => ({
  chain_id: chainId,
  block_number: hexToNumber(block.number),
  transaction_index: hexToNumber(transaction.transactionIndex),
  trace_index: trace.trace.index,
  body: trace,
});

type RpcRequestResultsTable = {
  request: string;
  request_hash: ColumnType<string, undefined>;
  chain_id: number;
  // TODO(kyle) number?
  block_number: ColumnType<
    string | undefined,
    string | bigint | undefined,
    string | bigint | undefined
  >;
  result: string;
};

type IntervalTable = {
  fragment_id: FragmentId;
  chain_id: number;
  blocks: string;
};

export type PonderSyncSchema = {
  blocks: BlocksTable;
  logs: LogsTable;
  transactions: TransactionsTable;
  transaction_receipts: TransactionReceiptsTable;
  traces: TracesTable;

  rpc_request_results: RpcRequestResultsTable;

  intervals: IntervalTable;
};
