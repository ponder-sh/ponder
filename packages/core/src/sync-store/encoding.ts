import type {
  SyncBlock,
  SyncCallTrace,
  SyncLog,
  SyncTransaction,
  SyncTransactionReceipt,
} from "@/types/sync.js";
import {
  EVENT_TYPES,
  encodeCheckpoint,
  maxCheckpoint,
  zeroCheckpoint,
} from "@/utils/checkpoint.js";
import { toLowerCase } from "@/utils/lowercase.js";
import type { ColumnType, Generated, Insertable } from "kysely";
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
      transactionIndex: maxCheckpoint.transactionIndex,
      eventType: EVENT_TYPES.blocks,
      eventIndex: zeroCheckpoint.eventIndex,
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

  chainId: number;
};

export const encodeTransaction = ({
  transaction,
  chainId,
}: {
  transaction: SyncTransaction;
  chainId: number;
}): Insertable<TransactionsTable> => {
  return {
    hash: transaction.hash,
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
  logs: string;
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
    logs: JSON.stringify(transactionReceipt.logs),
    logsBloom: transactionReceipt.logsBloom,
    status: transactionReceipt.status,
    to: transactionReceipt.to ? toLowerCase(transactionReceipt.to) : null,
    transactionIndex: hexToNumber(transactionReceipt.transactionIndex),
    type: transactionReceipt.type as Hex,
  };
};

type CallTracesTable = {
  id: string;
  chainId: number;
  checkpoint: string;
  callType: string;
  from: Address;
  gas: ColumnType<string, string | bigint, string | bigint>;
  input: Hex;
  to: Address;
  value: ColumnType<string, string | bigint, string | bigint>;
  blockHash: Hex;
  blockNumber: ColumnType<string, string | bigint, string | bigint>;
  error: string | null;
  gasUsed: ColumnType<string, string | bigint, string | bigint> | null;
  output: Hex | null;
  subtraces: number;
  traceAddress: string;
  transactionHash: Hex;
  transactionPosition: number;
  functionSelector: Hex;
};

export function encodeCallTrace({
  trace,
  chainId,
}: {
  trace: SyncCallTrace;
  chainId: number;
}): Insertable<Omit<CallTracesTable, "checkpoint">> {
  return {
    id: `${trace.transactionHash}-${JSON.stringify(trace.traceAddress)}`,
    chainId,
    callType: trace.action.callType,
    from: toLowerCase(trace.action.from),
    gas: hexToBigInt(trace.action.gas),
    input: trace.action.input,
    to: toLowerCase(trace.action.to),
    value: hexToBigInt(trace.action.value),
    blockHash: trace.blockHash,
    blockNumber: hexToBigInt(trace.blockNumber),
    error: trace.error ?? null,
    gasUsed: trace.result ? hexToBigInt(trace.result.gasUsed) : null,
    output: trace.result ? trace.result.output : null,
    subtraces: trace.subtraces,
    traceAddress: JSON.stringify(trace.traceAddress),
    transactionHash: trace.transactionHash,
    transactionPosition: trace.transactionPosition,
    functionSelector: trace.action.input.slice(0, 10).toLowerCase() as Hex,
  };
}

type RpcRequestResultsTable = {
  request: string;
  chainId: number;
  blockNumber: ColumnType<string, string | bigint, string | bigint>;
  result: string;
};

type LogFiltersTable = {
  id: string;
  chainId: number;
  address: Hex | null;
  topic0: Hex | null;
  topic1: Hex | null;
  topic2: Hex | null;
  topic3: Hex | null;
  includeTransactionReceipts: 0 | 1;
};

type LogFilterIntervalsTable = {
  id: Generated<number>;
  logFilterId: string;
  startBlock: ColumnType<string, string | bigint, string | bigint>;
  endBlock: ColumnType<string, string | bigint, string | bigint>;
};

type FactoryLogFiltersTable = {
  id: string;
  chainId: number;
  address: Hex;
  eventSelector: Hex;
  childAddressLocation: `topic${1 | 2 | 3}` | `offset${number}`;
  topic0: Hex | null;
  topic1: Hex | null;
  topic2: Hex | null;
  topic3: Hex | null;
  includeTransactionReceipts: 0 | 1;
};

type FactoryLogFilterIntervalsTable = {
  id: Generated<number>;
  factoryId: string;
  startBlock: ColumnType<string, string | bigint, string | bigint>;
  endBlock: ColumnType<string, string | bigint, string | bigint>;
};

type TraceFiltersTable = {
  id: string;
  chainId: number;
  fromAddress: Address | null;
  toAddress: Address | null;
};

type TraceFilterIntervalsTable = {
  id: Generated<number>;
  traceFilterId: string;
  startBlock: ColumnType<string, string | bigint, string | bigint>;
  endBlock: ColumnType<string, string | bigint, string | bigint>;
};

type FactoryTraceFiltersTable = {
  id: string;
  chainId: number;
  address: Hex;
  eventSelector: Hex;
  childAddressLocation: `topic${1 | 2 | 3}` | `offset${number}`;
  fromAddress: Address | null;
};

type FactoryTraceFilterIntervalsTable = {
  id: Generated<number>;
  factoryId: string;
  startBlock: ColumnType<string, string | bigint, string | bigint>;
  endBlock: ColumnType<string, string | bigint, string | bigint>;
};

type BlockFiltersTable = {
  id: string;
  chainId: number;
  interval: number;
  offset: number;
};

type BlockFilterIntervalsTable = {
  id: Generated<number>;
  blockFilterId: string;
  startBlock: ColumnType<string, string | bigint, string | bigint>;
  endBlock: ColumnType<string, string | bigint, string | bigint>;
};

export type PonderSyncSchema = {
  blocks: BlocksTable;
  logs: LogsTable;
  transactions: TransactionsTable;
  transactionReceipts: TransactionReceiptsTable;
  callTraces: CallTracesTable;

  rpcRequestResults: RpcRequestResultsTable;

  logFilters: LogFiltersTable;
  logFilterIntervals: LogFilterIntervalsTable;
  factoryLogFilters: FactoryLogFiltersTable;
  factoryLogFilterIntervals: FactoryLogFilterIntervalsTable;
  traceFilters: TraceFiltersTable;
  traceFilterIntervals: TraceFilterIntervalsTable;
  factoryTraceFilters: FactoryTraceFiltersTable;
  factoryTraceFilterIntervals: FactoryTraceFilterIntervalsTable;
  blockFilters: BlockFiltersTable;
  blockFilterIntervals: BlockFilterIntervalsTable;
};
