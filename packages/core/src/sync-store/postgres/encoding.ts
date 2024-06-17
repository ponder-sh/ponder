import type { SyncCallTrace } from "@/sync/index.js";
import { toLowerCase } from "@/utils/lowercase.js";
import type { Generated, Insertable } from "kysely";
import {
  type Address,
  type Hash,
  type Hex,
  type RpcTransactionReceipt,
  hexToBigInt,
} from "viem";
import {
  type RpcBlock,
  type RpcLog,
  type RpcTransaction,
  hexToNumber,
} from "viem";

type BlocksTable = {
  baseFeePerGas: bigint | null;
  difficulty: bigint;
  extraData: Hex;
  gasLimit: bigint;
  gasUsed: bigint;
  hash: Hash;
  logsBloom: Hex;
  miner: Address;
  mixHash: Hash | null;
  nonce: Hex | null;
  number: bigint;
  parentHash: Hash;
  receiptsRoot: Hex;
  sha3Uncles: Hash | null;
  size: bigint;
  stateRoot: Hash;
  timestamp: bigint;
  totalDifficulty: bigint | null;
  transactionsRoot: Hash;

  chainId: number;
  checkpoint: string;
};

export type InsertableBlock = Insertable<BlocksTable>;

export function rpcToPostgresBlock(
  block: RpcBlock,
): Omit<InsertableBlock, "chainId" | "checkpoint"> {
  return {
    baseFeePerGas: block.baseFeePerGas ? BigInt(block.baseFeePerGas) : null,
    difficulty: BigInt(block.difficulty),
    extraData: block.extraData,
    gasLimit: BigInt(block.gasLimit),
    gasUsed: BigInt(block.gasUsed),
    hash: block.hash!,
    logsBloom: block.logsBloom!,
    miner: toLowerCase(block.miner),
    mixHash: block.mixHash ?? null,
    nonce: block.nonce ?? null,
    number: BigInt(block.number!),
    parentHash: block.parentHash,
    receiptsRoot: block.receiptsRoot,
    sha3Uncles: block.sha3Uncles ?? null,
    size: BigInt(block.size),
    stateRoot: block.stateRoot,
    timestamp: BigInt(block.timestamp),
    totalDifficulty: block.totalDifficulty
      ? BigInt(block.totalDifficulty)
      : null,
    transactionsRoot: block.transactionsRoot,
  };
}

type TransactionsTable = {
  blockHash: Hash;
  blockNumber: bigint;
  from: Address;
  gas: bigint;
  hash: Hash;
  input: Hex;
  nonce: number;
  r: Hex | null;
  s: Hex | null;
  to: Address | null;
  transactionIndex: number;
  v: bigint | null;
  value: bigint;

  type: Hex;
  gasPrice: bigint | null;
  maxFeePerGas: bigint | null;
  maxPriorityFeePerGas: bigint | null;
  accessList: string | null;

  chainId: number;
};

export type InsertableTransaction = Insertable<TransactionsTable>;

export function rpcToPostgresTransaction(
  transaction: RpcTransaction,
): Omit<InsertableTransaction, "chainId"> {
  return {
    accessList: transaction.accessList
      ? JSON.stringify(transaction.accessList)
      : undefined,
    blockHash: transaction.blockHash!,
    blockNumber: BigInt(transaction.blockNumber!),
    from: toLowerCase(transaction.from),
    gas: BigInt(transaction.gas),
    gasPrice: transaction.gasPrice ? BigInt(transaction.gasPrice) : null,
    hash: transaction.hash,
    input: transaction.input,
    maxFeePerGas: transaction.maxFeePerGas
      ? BigInt(transaction.maxFeePerGas)
      : null,
    maxPriorityFeePerGas: transaction.maxPriorityFeePerGas
      ? BigInt(transaction.maxPriorityFeePerGas)
      : null,
    nonce: hexToNumber(transaction.nonce),
    r: transaction.r ?? null,
    s: transaction.s ?? null,
    to: transaction.to ? toLowerCase(transaction.to) : null,
    transactionIndex: Number(transaction.transactionIndex),
    type: transaction.type ?? "0x0",
    value: BigInt(transaction.value),
    v: transaction.v ? BigInt(transaction.v) : null,
  };
}

type TransactionReceiptsTable = {
  blockHash: Hash;
  blockNumber: bigint;
  contractAddress: Address | null;
  cumulativeGasUsed: bigint;
  effectiveGasPrice: bigint;
  from: Address;
  gasUsed: bigint;
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

export function rpcToPostgresTransactionReceipt(
  transactionReceipt: RpcTransactionReceipt,
): Omit<TransactionReceiptsTable, "chainId"> {
  return {
    blockHash: transactionReceipt.blockHash,
    blockNumber: BigInt(transactionReceipt.blockNumber),
    contractAddress: transactionReceipt.contractAddress
      ? toLowerCase(transactionReceipt.contractAddress)
      : null,
    cumulativeGasUsed: BigInt(transactionReceipt.cumulativeGasUsed),
    effectiveGasPrice: BigInt(transactionReceipt.effectiveGasPrice),
    from: toLowerCase(transactionReceipt.from),
    gasUsed: BigInt(transactionReceipt.gasUsed),
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
  blockNumber: bigint;
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

export function rpcToPostgresLog(log: RpcLog): Omit<InsertableLog, "chainId"> {
  return {
    address: toLowerCase(log.address),
    blockHash: log.blockHash!,
    blockNumber: BigInt(log.blockNumber!),
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
  gas: bigint;
  input: Hex;
  to: Address;
  value: bigint;
  blockHash: Hex;
  blockNumber: bigint;
  error: string | null;
  gasUsed: bigint | null;
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

export function rpcToPostgresTrace(
  trace: SyncCallTrace,
): Omit<InsertableCallTrace, "chainId" | "checkpoint"> {
  return {
    id: `${trace.transactionHash}-${JSON.stringify(trace.traceAddress)}`,
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
  blockNumber: bigint;
  chainId: number;
  request: string;
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
  startBlock: bigint;
  endBlock: bigint;
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
  startBlock: bigint;
  endBlock: bigint;
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
  startBlock: bigint;
  endBlock: bigint;
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
  startBlock: bigint;
  endBlock: bigint;
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
  startBlock: bigint;
  endBlock: bigint;
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
