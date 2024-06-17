import type { SyncCallTrace } from "@/sync/index.js";
import { encodeAsText } from "@/utils/encoding.js";
import { toLowerCase } from "@/utils/lowercase.js";
import type { Generated, Insertable } from "kysely";
import type { Address, Hash, Hex, RpcTransactionReceipt } from "viem";
import {
  type RpcBlock,
  type RpcLog,
  type RpcTransaction,
  hexToNumber,
} from "viem";

export type BigIntText = string;

type BlocksTable = {
  baseFeePerGas: BigIntText | null;
  difficulty: BigIntText;
  extraData: Hex;
  gasLimit: BigIntText;
  gasUsed: BigIntText;
  hash: Hash;
  logsBloom: Hex;
  miner: Address;
  mixHash: Hash | null;
  nonce: Hex | null;
  number: BigIntText;
  parentHash: Hash;
  receiptsRoot: Hex;
  sha3Uncles: Hash | null;
  size: BigIntText;
  stateRoot: Hash;
  timestamp: BigIntText;
  totalDifficulty: BigIntText | null;
  transactionsRoot: Hash;

  chainId: number;
  checkpoint: string;
};

export type InsertableBlock = Insertable<BlocksTable>;

export function rpcToSqliteBlock(
  block: RpcBlock,
): Omit<InsertableBlock, "chainId" | "checkpoint"> {
  return {
    baseFeePerGas: block.baseFeePerGas
      ? encodeAsText(block.baseFeePerGas)
      : null,
    difficulty: encodeAsText(block.difficulty),
    extraData: block.extraData,
    gasLimit: encodeAsText(block.gasLimit),
    gasUsed: encodeAsText(block.gasUsed),
    hash: block.hash!,
    logsBloom: block.logsBloom!,
    miner: toLowerCase(block.miner),
    mixHash: block.mixHash ?? null,
    nonce: block.nonce ?? null,
    number: encodeAsText(block.number!),
    parentHash: block.parentHash,
    receiptsRoot: block.receiptsRoot,
    sha3Uncles: block.sha3Uncles ?? null,
    size: encodeAsText(block.size),
    stateRoot: block.stateRoot,
    timestamp: encodeAsText(block.timestamp),
    totalDifficulty: block.totalDifficulty
      ? encodeAsText(block.totalDifficulty)
      : null,
    transactionsRoot: block.transactionsRoot,
  };
}

type TransactionsTable = {
  blockHash: Hash;
  blockNumber: BigIntText;
  from: Address;
  gas: BigIntText;
  hash: Hash;
  input: Hex;
  nonce: number;
  r: Hex | null;
  s: Hex | null;
  to: Address | null;
  transactionIndex: number;
  v: BigIntText | null;
  value: BigIntText;

  type: Hex;
  gasPrice: BigIntText | null;
  maxFeePerGas: BigIntText | null;
  maxPriorityFeePerGas: BigIntText | null;
  accessList: string | null;

  chainId: number;
};

export type InsertableTransaction = Insertable<TransactionsTable>;

export function rpcToSqliteTransaction(
  transaction: RpcTransaction,
): Omit<InsertableTransaction, "chainId"> {
  return {
    accessList: transaction.accessList
      ? JSON.stringify(transaction.accessList)
      : undefined,
    blockHash: transaction.blockHash!,
    blockNumber: encodeAsText(transaction.blockNumber!),
    from: toLowerCase(transaction.from),
    gas: encodeAsText(transaction.gas),
    gasPrice: transaction.gasPrice ? encodeAsText(transaction.gasPrice) : null,
    hash: transaction.hash,
    input: transaction.input,
    maxFeePerGas: transaction.maxFeePerGas
      ? encodeAsText(transaction.maxFeePerGas)
      : null,
    maxPriorityFeePerGas: transaction.maxPriorityFeePerGas
      ? encodeAsText(transaction.maxPriorityFeePerGas)
      : null,
    nonce: hexToNumber(transaction.nonce),
    r: transaction.r ?? null,
    s: transaction.s ?? null,
    to: transaction.to ? toLowerCase(transaction.to) : null,
    transactionIndex: Number(transaction.transactionIndex),
    type: transaction.type ?? "0x0",
    value: encodeAsText(transaction.value),
    v: transaction.v ? encodeAsText(transaction.v) : null,
  };
}

type TransactionReceiptsTable = {
  blockHash: Hash;
  blockNumber: BigIntText;
  contractAddress: Address | null;
  cumulativeGasUsed: BigIntText;
  effectiveGasPrice: BigIntText;
  from: Address;
  gasUsed: BigIntText;
  logs: string;
  logsBloom: Hex;
  status: Hex;
  to: Address | null;
  transactionHash: Hash;
  transactionIndex: number;
  type: Hex;

  chainId: number;
};

export type InsertableTransactionReceipts =
  Insertable<TransactionReceiptsTable>;

export function rpcToSqliteTransactionReceipt(
  transactionReceipt: RpcTransactionReceipt,
): Omit<TransactionReceiptsTable, "chainId"> {
  return {
    blockHash: transactionReceipt.blockHash,
    blockNumber: encodeAsText(transactionReceipt.blockNumber),
    contractAddress: transactionReceipt.contractAddress
      ? toLowerCase(transactionReceipt.contractAddress)
      : null,
    cumulativeGasUsed: encodeAsText(transactionReceipt.cumulativeGasUsed),
    effectiveGasPrice: encodeAsText(transactionReceipt.effectiveGasPrice),
    from: toLowerCase(transactionReceipt.from),
    gasUsed: encodeAsText(transactionReceipt.gasUsed),
    logs: JSON.stringify(transactionReceipt.logs),
    logsBloom: transactionReceipt.logsBloom,
    status: transactionReceipt.status,
    to: transactionReceipt.to ? toLowerCase(transactionReceipt.to) : null,
    transactionHash: transactionReceipt.transactionHash,
    transactionIndex: Number(transactionReceipt.transactionIndex),
    type: transactionReceipt.type as Hex,
  };
}

type LogsTable = {
  id: string;
  address: Address;
  blockHash: Hash;
  blockNumber: BigIntText;
  data: Hex;
  logIndex: number;
  transactionHash: Hash;
  transactionIndex: number;

  topic0: Hex | null;
  topic1: Hex | null;
  topic2: Hex | null;
  topic3: Hex | null;

  chainId: number;
  checkpoint?: string;
};

export type InsertableLog = Insertable<LogsTable>;

export function rpcToSqliteLog(log: RpcLog): Omit<InsertableLog, "chainId"> {
  return {
    address: toLowerCase(log.address),
    blockHash: log.blockHash!,
    blockNumber: encodeAsText(log.blockNumber!),
    data: log.data,
    id: `${log.blockHash}-${log.logIndex}`,
    logIndex: Number(log.logIndex!),
    topic0: log.topics[0] ? log.topics[0] : null,
    topic1: log.topics[1] ? log.topics[1] : null,
    topic2: log.topics[2] ? log.topics[2] : null,
    topic3: log.topics[3] ? log.topics[3] : null,
    transactionHash: log.transactionHash!,
    transactionIndex: Number(log.transactionIndex!),
  };
}

type CallTracesTable = {
  id: string;
  callType: string;
  from: Address;
  gas: BigIntText;
  input: Hex;
  to: Address;
  value: BigIntText;
  blockHash: Hex;
  blockNumber: BigIntText;
  error: string | null;
  gasUsed: BigIntText | null;
  output: Hex | null;
  subtraces: number;
  traceAddress: string;
  transactionHash: Hex;
  transactionPosition: number;
  functionSelector: Hex;
  chainId: number;
  checkpoint: string;
};

export type InsertableCallTrace = Insertable<CallTracesTable>;

export function rpcToSqliteTrace(
  trace: SyncCallTrace,
): Omit<InsertableCallTrace, "chainId" | "checkpoint"> {
  return {
    id: `${trace.transactionHash}-${JSON.stringify(trace.traceAddress)}`,
    callType: trace.action.callType,
    from: toLowerCase(trace.action.from),
    gas: encodeAsText(trace.action.gas),
    input: trace.action.input,
    to: toLowerCase(trace.action.to),
    value: encodeAsText(trace.action.value),
    blockHash: trace.blockHash,
    blockNumber: encodeAsText(trace.blockNumber),
    error: trace.error ?? null,
    gasUsed: trace.result ? encodeAsText(trace.result.gasUsed) : null,
    output: trace.result ? trace.result.output : null,
    subtraces: trace.subtraces,
    traceAddress: JSON.stringify(trace.traceAddress),
    transactionHash: trace.transactionHash,
    transactionPosition: trace.transactionPosition,
    functionSelector: trace.action.input.slice(0, 10).toLowerCase() as Hex,
  };
}

type RpcRequestResultsTable = {
  blockNumber: BigIntText;
  chainId: number;
  result: string;
  request: string;
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
  startBlock: BigIntText;
  endBlock: BigIntText;
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
  startBlock: BigIntText;
  endBlock: BigIntText;
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
  startBlock: BigIntText;
  endBlock: BigIntText;
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
  startBlock: BigIntText;
  endBlock: BigIntText;
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
  startBlock: BigIntText;
  endBlock: BigIntText;
};

export type SyncStoreTables = {
  blocks: BlocksTable;
  transactions: TransactionsTable;
  transactionReceipts: TransactionReceiptsTable;
  logs: LogsTable;
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
