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
import { decodeToBigInt, encodeAsText } from "@/utils/encoding.js";
import { toLowerCase } from "@/utils/lowercase.js";
import type { Generated, Insertable } from "kysely";
import type { Address, Hash, Hex } from "viem";
import { hexToBigInt, hexToNumber } from "viem";

const formatHex = (dialect: "sqlite" | "postgres", hex: Hex) =>
  dialect === "sqlite" ? encodeAsText(hex) : hexToBigInt(hex);

export const formatBig = (
  dialect: "sqlite" | "postgres",
  x: bigint | number,
): string | bigint =>
  dialect === "sqlite"
    ? encodeAsText(x)
    : typeof x === "number"
      ? BigInt(x)
      : x;

export const parseBig = (
  dialect: "sqlite" | "postgres",
  big: string | bigint,
): bigint =>
  dialect === "sqlite" ? decodeToBigInt(big as string) : (big as bigint);

type BlocksTable = {
  hash: Hash;
  chainId: number;
  checkpoint: string;
  number: string | bigint;
  timestamp: string | bigint;
  baseFeePerGas: string | bigint | null;
  difficulty: string | bigint;
  extraData: Hex;
  gasLimit: string | bigint;
  gasUsed: string | bigint;
  logsBloom: Hex;
  miner: Address;
  mixHash: Hash | null;
  nonce: Hex | null;
  parentHash: Hash;
  receiptsRoot: Hex;
  sha3Uncles: Hash | null;
  size: string | bigint;
  stateRoot: Hash;
  totalDifficulty: string | bigint | null;
  transactionsRoot: Hash;
};

export const encodeBlock = ({
  block,
  chainId,
  dialect,
}: {
  block: SyncBlock;
  chainId: number;
  dialect: "sqlite" | "postgres";
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
      ? formatHex(dialect, block.baseFeePerGas)
      : null,
    difficulty: formatHex(dialect, block.difficulty),
    number: formatHex(dialect, block.number),
    timestamp: formatHex(dialect, block.timestamp),
    extraData: block.extraData,
    gasLimit: formatHex(dialect, block.gasLimit),
    gasUsed: formatHex(dialect, block.gasUsed),
    logsBloom: block.logsBloom!,
    miner: toLowerCase(block.miner),
    mixHash: block.mixHash ?? null,
    nonce: block.nonce ?? null,
    parentHash: block.parentHash,
    receiptsRoot: block.receiptsRoot,
    sha3Uncles: block.sha3Uncles ?? null,
    size: formatHex(dialect, block.size),
    stateRoot: block.stateRoot,
    totalDifficulty: block.totalDifficulty
      ? formatHex(dialect, block.totalDifficulty)
      : null,
    transactionsRoot: block.transactionsRoot,
  };
};

type LogsTable = {
  id: string;
  chainId: number;
  checkpoint: string | null;
  blockHash: Hash;
  blockNumber: string | bigint;
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
  dialect,
}: {
  log: SyncLog;
  block?: SyncBlock;
  chainId: number;
  dialect: "sqlite" | "postgres";
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
    blockNumber: formatHex(dialect, log.blockNumber),
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
  blockNumber: string | bigint;
  from: Address;
  gas: string | bigint;
  input: Hex;
  nonce: number;
  r: Hex | null;
  s: Hex | null;
  to: Address | null;
  transactionIndex: number;
  v: string | bigint | null;
  value: string | bigint;
  type: Hex;
  gasPrice: string | bigint | null;
  maxFeePerGas: string | bigint | null;
  maxPriorityFeePerGas: string | bigint | null;
  accessList: string | null;

  chainId: number;
};

export const encodeTransaction = ({
  transaction,
  chainId,
  dialect,
}: {
  transaction: SyncTransaction;
  chainId: number;
  dialect: "sqlite" | "postgres";
}): Insertable<TransactionsTable> => {
  return {
    hash: transaction.hash,
    chainId,
    blockHash: transaction.blockHash,
    blockNumber: formatHex(dialect, transaction.blockNumber),
    accessList: transaction.accessList
      ? JSON.stringify(transaction.accessList)
      : undefined,
    from: toLowerCase(transaction.from),
    gas: formatHex(dialect, transaction.gas),
    gasPrice: transaction.gasPrice
      ? formatHex(dialect, transaction.gasPrice)
      : null,
    input: transaction.input,
    maxFeePerGas: transaction.maxFeePerGas
      ? formatHex(dialect, transaction.maxFeePerGas)
      : null,
    maxPriorityFeePerGas: transaction.maxPriorityFeePerGas
      ? formatHex(dialect, transaction.maxPriorityFeePerGas)
      : null,
    nonce: hexToNumber(transaction.nonce),
    r: transaction.r ?? null,
    s: transaction.s ?? null,
    to: transaction.to ? toLowerCase(transaction.to) : null,
    transactionIndex: hexToNumber(transaction.transactionIndex),
    type: transaction.type ?? "0x0",
    value: formatHex(dialect, transaction.value),
    v: transaction.v ? formatHex(dialect, transaction.v) : null,
  };
};

type TransactionReceiptsTable = {
  transactionHash: Hash;
  chainId: number;
  blockHash: Hash;
  blockNumber: string | bigint;
  contractAddress: Address | null;
  cumulativeGasUsed: string | bigint;
  effectiveGasPrice: string | bigint;
  from: Address;
  gasUsed: string | bigint;
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
  dialect,
}: {
  transactionReceipt: SyncTransactionReceipt;
  chainId: number;
  dialect: "sqlite" | "postgres";
}): Insertable<TransactionReceiptsTable> => {
  return {
    transactionHash: transactionReceipt.transactionHash,
    chainId,
    blockHash: transactionReceipt.blockHash,
    blockNumber: formatHex(dialect, transactionReceipt.blockNumber),
    contractAddress: transactionReceipt.contractAddress
      ? toLowerCase(transactionReceipt.contractAddress)
      : null,
    cumulativeGasUsed: formatHex(dialect, transactionReceipt.cumulativeGasUsed),
    effectiveGasPrice: formatHex(dialect, transactionReceipt.effectiveGasPrice),
    from: toLowerCase(transactionReceipt.from),
    gasUsed: formatHex(dialect, transactionReceipt.gasUsed),
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
  gas: string | bigint;
  input: Hex;
  to: Address;
  value: string | bigint;
  blockHash: Hex;
  blockNumber: string | bigint;
  error: string | null;
  gasUsed: string | bigint | null;
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
  dialect,
}: {
  trace: SyncCallTrace;
  chainId: number;
  dialect: "sqlite" | "postgres";
}): Insertable<Omit<CallTracesTable, "checkpoint">> {
  return {
    id: `${trace.transactionHash}-${JSON.stringify(trace.traceAddress)}`,
    chainId,
    callType: trace.action.callType,
    from: toLowerCase(trace.action.from),
    gas: formatHex(dialect, trace.action.gas),
    input: trace.action.input,
    to: toLowerCase(trace.action.to),
    value: formatHex(dialect, trace.action.value),
    blockHash: trace.blockHash,
    blockNumber: formatHex(dialect, trace.blockNumber),
    error: trace.error ?? null,
    gasUsed: trace.result ? formatHex(dialect, trace.result.gasUsed) : null,
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
  blockNumber: string | bigint;
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
  startBlock: string | bigint;
  endBlock: string | bigint;
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
  startBlock: string | bigint;
  endBlock: string | bigint;
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
  startBlock: string | bigint;
  endBlock: string | bigint;
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
  startBlock: string | bigint;
  endBlock: string | bigint;
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
  startBlock: string | bigint;
  endBlock: string | bigint;
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
