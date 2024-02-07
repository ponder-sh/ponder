import type { Generated, Insertable } from "kysely";
import type { Address, Hash, Hex } from "viem";
import {
  type RpcBlock,
  type RpcLog,
  type RpcTransaction,
  hexToNumber,
} from "viem";

import { encodeAsText } from "@/utils/encoding.js";
import { toLowerCase } from "@/utils/lowercase.js";

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
  sha3Uncles: Hash;
  size: BigIntText;
  stateRoot: Hash;
  timestamp: BigIntText;
  totalDifficulty: BigIntText;
  transactionsRoot: Hash;

  chainId: number;
};

export type InsertableBlock = Insertable<BlocksTable>;

export function rpcToSqliteBlock(
  block: RpcBlock,
): Omit<InsertableBlock, "chainId"> {
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
    sha3Uncles: block.sha3Uncles,
    size: encodeAsText(block.size),
    stateRoot: block.stateRoot,
    timestamp: encodeAsText(block.timestamp),
    totalDifficulty: encodeAsText(block.totalDifficulty!),
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
  r: Hex;
  s: Hex;
  to: Address | null;
  transactionIndex: number;
  v: BigIntText;
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
    r: transaction.r,
    s: transaction.s,
    to: transaction.to ? toLowerCase(transaction.to) : null,
    transactionIndex: Number(transaction.transactionIndex),
    type: transaction.type ?? "0x0",
    value: encodeAsText(transaction.value),
    v: encodeAsText(transaction.v),
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
};

type LogFilterIntervalsTable = {
  id: Generated<number>;
  logFilterId: string;
  startBlock: BigIntText;
  endBlock: BigIntText;
};

type FactoriesTable = {
  id: string;
  chainId: number;
  address: Hex;
  eventSelector: Hex;
  childAddressLocation: `topic${1 | 2 | 3}` | `offset${number}`;
  topic0: Hex | null;
  topic1: Hex | null;
  topic2: Hex | null;
  topic3: Hex | null;
};

type FactoryLogFilterIntervalsTable = {
  id: Generated<number>;
  factoryId: string;
  startBlock: BigIntText;
  endBlock: BigIntText;
};

export type SyncStoreTables = {
  blocks: BlocksTable;
  transactions: TransactionsTable;
  logs: LogsTable;
  rpcRequestResults: RpcRequestResultsTable;

  logFilters: LogFiltersTable;
  logFilterIntervals: LogFilterIntervalsTable;
  factories: FactoriesTable;
  factoryLogFilterIntervals: FactoryLogFilterIntervalsTable;
};
