import type { FragmentId } from "@/internal/types.js";
import type {
  SyncBlock,
  SyncLog,
  SyncTrace,
  SyncTransaction,
  SyncTransactionReceipt,
} from "@/types/sync.js";
import {
  EVENT_TYPES,
  MAX_CHECKPOINT,
  ZERO_CHECKPOINT,
  encodeCheckpoint,
} from "@/utils/checkpoint.js";
import { toLowerCase } from "@/utils/lowercase.js";
import type { ColumnType, Insertable } from "kysely";
import type { Address, Hash, Hex } from "viem";
import { hexToBigInt, hexToNumber } from "viem";

type BlocksTable = {
  hash: Hash;
  chainId: number;
  checkpoint: string;
  number: ColumnType<string, string | bigint, string | bigint>;
  timestamp: ColumnType<string, string | bigint, string | bigint>;
  baseFeePerGas: ColumnType<string, string | bigint, string | bigint> | null;
  difficulty: ColumnType<string, string | bigint, string | bigint>;
  extraData: Hex;
  gasLimit: ColumnType<string, string | bigint, string | bigint>;
  gasUsed: ColumnType<string, string | bigint, string | bigint>;
  logsBloom: Hex;
  miner: Address;
  mixHash: Hash | null;
  nonce: Hex | null;
  parentHash: Hash;
  receiptsRoot: Hex;
  sha3Uncles: Hash | null;
  size: ColumnType<string, string | bigint, string | bigint>;
  stateRoot: Hash;
  totalDifficulty: ColumnType<string, string | bigint, string | bigint> | null;
  transactionsRoot: Hash;
};

export const encodeBlock = ({
  block,
  chainId,
}: {
  block: SyncBlock;
  chainId: number;
}): Insertable<BlocksTable> => {
  return {
    hash: block.hash,
    chainId,
    checkpoint: encodeCheckpoint({
      blockTimestamp: hexToNumber(block.timestamp),
      chainId: BigInt(chainId),
      blockNumber: hexToBigInt(block.number),
      transactionIndex: MAX_CHECKPOINT.transactionIndex,
      eventType: EVENT_TYPES.blocks,
      eventIndex: ZERO_CHECKPOINT.eventIndex,
    }),
    baseFeePerGas: block.baseFeePerGas
      ? hexToBigInt(block.baseFeePerGas)
      : null,
    difficulty: hexToBigInt(block.difficulty),
    number: hexToBigInt(block.number),
    timestamp: hexToBigInt(block.timestamp),
    extraData: block.extraData,
    gasLimit: hexToBigInt(block.gasLimit),
    gasUsed: hexToBigInt(block.gasUsed),
    logsBloom: block.logsBloom!,
    miner: toLowerCase(block.miner),
    mixHash: block.mixHash ?? null,
    nonce: block.nonce ?? null,
    parentHash: block.parentHash,
    receiptsRoot: block.receiptsRoot,
    sha3Uncles: block.sha3Uncles ?? null,
    size: hexToBigInt(block.size),
    stateRoot: block.stateRoot,
    totalDifficulty: block.totalDifficulty
      ? hexToBigInt(block.totalDifficulty)
      : null,
    transactionsRoot: block.transactionsRoot,
  };
};

type LogsTable = {
  id: string;
  chainId: number;
  checkpoint: string | null;
  blockHash: Hash;
  blockNumber: ColumnType<string, string | bigint, string | bigint>;
  logIndex: number;
  transactionHash: Hash;
  transactionIndex: number;
  address: Address;
  topic0: Hex | null;
  topic1: Hex | null;
  topic2: Hex | null;
  topic3: Hex | null;
  data: Hex;
};

export const encodeLog = ({
  log,
  block,
  chainId,
}: {
  log: SyncLog;
  block?: SyncBlock;
  chainId: number;
}): Insertable<LogsTable> => {
  return {
    id: `${log.blockHash}-${log.logIndex}`,
    chainId,
    checkpoint:
      block === undefined
        ? null
        : encodeCheckpoint({
            blockTimestamp: hexToNumber(block.timestamp),
            chainId: BigInt(chainId),
            blockNumber: hexToBigInt(log.blockNumber),
            transactionIndex: hexToBigInt(log.transactionIndex),
            eventType: EVENT_TYPES.logs,
            eventIndex: hexToBigInt(log.logIndex),
          }),
    blockHash: log.blockHash,
    blockNumber: hexToBigInt(log.blockNumber),
    logIndex: hexToNumber(log.logIndex),
    transactionHash: log.transactionHash,
    transactionIndex: hexToNumber(log.transactionIndex),
    address: toLowerCase(log.address),
    topic0: log.topics[0] ? log.topics[0] : null,
    topic1: log.topics[1] ? log.topics[1] : null,
    topic2: log.topics[2] ? log.topics[2] : null,
    topic3: log.topics[3] ? log.topics[3] : null,
    data: log.data,
  };
};

type TransactionsTable = {
  hash: Hash;
  chainId: number;
  /** `checkpoint` will be null for transactions inserted before 0.8. This is to avoid a very slow migration. */
  checkpoint: string | null;
  blockHash: Hash;
  blockNumber: ColumnType<string, string | bigint, string | bigint>;
  from: Address;
  gas: ColumnType<string, string | bigint, string | bigint>;
  input: Hex;
  nonce: number;
  r: Hex | null;
  s: Hex | null;
  to: Address | null;
  transactionIndex: number;
  v: ColumnType<string, string | bigint, string | bigint> | null;
  value: ColumnType<string, string | bigint, string | bigint>;
  type: Hex;
  gasPrice: ColumnType<string, string | bigint, string | bigint> | null;
  maxFeePerGas: ColumnType<string, string | bigint, string | bigint> | null;
  maxPriorityFeePerGas: ColumnType<
    string,
    string | bigint,
    string | bigint
  > | null;
  accessList: string | null;
};

export const encodeTransaction = ({
  transaction,
  block,
  chainId,
}: {
  transaction: SyncTransaction;
  block: Pick<SyncBlock, "timestamp">;
  chainId: number;
}): Insertable<TransactionsTable> => {
  return {
    hash: transaction.hash,
    checkpoint: encodeCheckpoint({
      blockTimestamp: hexToNumber(block.timestamp),
      chainId: BigInt(chainId),
      blockNumber: hexToBigInt(transaction.blockNumber),
      transactionIndex: hexToBigInt(transaction.transactionIndex),
      eventType: EVENT_TYPES.transactions,
      eventIndex: ZERO_CHECKPOINT.eventIndex,
    }),
    chainId,
    blockHash: transaction.blockHash,
    blockNumber: hexToBigInt(transaction.blockNumber),
    accessList: transaction.accessList
      ? JSON.stringify(transaction.accessList)
      : undefined,
    from: toLowerCase(transaction.from),
    gas: hexToBigInt(transaction.gas),
    gasPrice: transaction.gasPrice ? hexToBigInt(transaction.gasPrice) : null,
    input: transaction.input,
    maxFeePerGas: transaction.maxFeePerGas
      ? hexToBigInt(transaction.maxFeePerGas)
      : null,
    maxPriorityFeePerGas: transaction.maxPriorityFeePerGas
      ? hexToBigInt(transaction.maxPriorityFeePerGas)
      : null,
    nonce: hexToNumber(transaction.nonce),
    r: transaction.r ?? null,
    s: transaction.s ?? null,
    to: transaction.to ? toLowerCase(transaction.to) : null,
    transactionIndex: hexToNumber(transaction.transactionIndex),
    type: transaction.type ?? "0x0",
    value: hexToBigInt(transaction.value),
    v: transaction.v ? hexToBigInt(transaction.v) : null,
  };
};

type TransactionReceiptsTable = {
  transactionHash: Hash;
  chainId: number;
  blockHash: Hash;
  blockNumber: ColumnType<string, string | bigint, string | bigint>;
  contractAddress: Address | null;
  cumulativeGasUsed: ColumnType<string, string | bigint, string | bigint>;
  effectiveGasPrice: ColumnType<string, string | bigint, string | bigint>;
  from: Address;
  gasUsed: ColumnType<string, string | bigint, string | bigint>;
  logsBloom: Hex;
  status: Hex;
  to: Address | null;
  transactionIndex: number;
  type: Hex;
};

export const encodeTransactionReceipt = ({
  transactionReceipt,
  chainId,
}: {
  transactionReceipt: SyncTransactionReceipt;
  chainId: number;
}): Insertable<TransactionReceiptsTable> => {
  return {
    transactionHash: transactionReceipt.transactionHash,
    chainId,
    blockHash: transactionReceipt.blockHash,
    blockNumber: hexToBigInt(transactionReceipt.blockNumber),
    contractAddress: transactionReceipt.contractAddress
      ? toLowerCase(transactionReceipt.contractAddress)
      : null,
    cumulativeGasUsed: hexToBigInt(transactionReceipt.cumulativeGasUsed),
    effectiveGasPrice: hexToBigInt(transactionReceipt.effectiveGasPrice),
    from: toLowerCase(transactionReceipt.from),
    gasUsed: hexToBigInt(transactionReceipt.gasUsed),
    logsBloom: transactionReceipt.logsBloom,
    status: transactionReceipt.status,
    to: transactionReceipt.to ? toLowerCase(transactionReceipt.to) : null,
    transactionIndex: hexToNumber(transactionReceipt.transactionIndex),
    type: transactionReceipt.type as Hex,
  };
};

type TracesTable = {
  id: string;
  chainId: number;
  checkpoint: string;
  type: string;
  transactionHash: Hex;
  blockHash: Hex;
  blockNumber: ColumnType<string, string | bigint, string | bigint>;
  from: Address;
  to: Address | null;
  gas: ColumnType<string, string | bigint, string | bigint>;
  gasUsed: ColumnType<string, string | bigint, string | bigint>;
  input: Hex;
  functionSelector: Hex;
  output: Hex | null;
  error: string | null;
  revertReason: string | null;
  value: ColumnType<
    string | null,
    string | bigint | null,
    string | bigint | null
  >;
  index: number;
  subcalls: number;
  isReverted: number;
};

export function encodeTrace({
  trace,
  block,
  transaction,
  chainId,
}: {
  trace: Omit<SyncTrace["trace"], "calls" | "logs">;
  block: Pick<SyncBlock, "hash" | "number" | "timestamp">;
  transaction: Pick<SyncTransaction, "hash" | "transactionIndex">;
  chainId: number;
}): Insertable<TracesTable> {
  return {
    id: `${transaction.hash}-${trace.index}`,
    chainId,
    checkpoint: encodeCheckpoint({
      blockTimestamp: hexToNumber(block.timestamp),
      chainId: BigInt(chainId),
      blockNumber: hexToBigInt(block.number),
      transactionIndex: hexToBigInt(transaction.transactionIndex),
      eventType: EVENT_TYPES.traces,
      eventIndex: BigInt(trace.index),
    }),
    type: trace.type,
    transactionHash: transaction.hash,
    blockHash: block.hash,
    blockNumber: hexToBigInt(block.number),
    from: toLowerCase(trace.from),
    to: trace.to ? toLowerCase(trace.to) : null,
    gas: hexToBigInt(trace.gas),
    gasUsed: hexToBigInt(trace.gasUsed),
    input: trace.input,
    functionSelector: trace.input.slice(0, 10) as Hex,
    output: trace.output ?? null,
    revertReason: trace.revertReason
      ? trace.revertReason.replace(/\0/g, "")
      : null,
    error: trace.error ? trace.error.replace(/\0/g, "") : null,
    value: trace.value ? hexToBigInt(trace.value) : null,
    index: trace.index,
    subcalls: trace.subcalls,
    isReverted: trace.error === undefined ? 0 : 1,
  };
}

type RpcRequestResultsTable = {
  request: string;
  request_hash: ColumnType<string, undefined>;
  chain_id: number;
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
  transactionReceipts: TransactionReceiptsTable;
  traces: TracesTable;

  rpc_request_results: RpcRequestResultsTable;

  intervals: IntervalTable;
};
