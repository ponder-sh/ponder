import type { Generated, Insertable } from "kysely";
import type { Address, Hash, Hex } from "viem";
import {
  type RpcBlock,
  type RpcLog,
  type RpcTransaction,
  hexToNumber,
} from "viem";

import { intToBlob } from "@/utils/encode";

type BlocksTable = {
  baseFeePerGas: Buffer | null; // BigInt
  difficulty: Buffer; // BigInt
  extraData: Hex;
  gasLimit: Buffer; // BigInt
  gasUsed: Buffer; // BigInt
  hash: Hash;
  logsBloom: Hex;
  miner: Address;
  mixHash: Hash;
  nonce: Hex;
  number: Buffer; // BigInt
  parentHash: Hash;
  receiptsRoot: Hex;
  sha3Uncles: Hash;
  size: Buffer; // BigInt
  stateRoot: Hash;
  timestamp: Buffer; // BigInt
  totalDifficulty: Buffer; // BigInt
  transactionsRoot: Hash;

  chainId: number;
};

export type InsertableBlock = Insertable<BlocksTable>;

export function rpcToSqliteBlock(
  block: RpcBlock
): Omit<InsertableBlock, "chainId"> {
  return {
    baseFeePerGas: block.baseFeePerGas ? intToBlob(block.baseFeePerGas) : null,
    difficulty: intToBlob(block.difficulty),
    extraData: block.extraData,
    gasLimit: intToBlob(block.gasLimit),
    gasUsed: intToBlob(block.gasUsed),
    hash: block.hash!,
    logsBloom: block.logsBloom!,
    miner: block.miner,
    mixHash: block.mixHash,
    nonce: block.nonce!,
    number: intToBlob(block.number!),
    parentHash: block.parentHash,
    receiptsRoot: block.receiptsRoot,
    sha3Uncles: block.sha3Uncles,
    size: intToBlob(block.size),
    stateRoot: block.stateRoot,
    timestamp: intToBlob(block.timestamp),
    totalDifficulty: intToBlob(block.totalDifficulty!),
    transactionsRoot: block.transactionsRoot,
  };
}

type TransactionsTable = {
  blockHash: Hash;
  blockNumber: Buffer; // BigInt
  from: Address;
  gas: Buffer; // BigInt
  hash: Hash;
  input: Hex;
  nonce: number;
  r: Hex;
  s: Hex;
  to: Address | null;
  transactionIndex: number;
  v: Buffer; // BigInt
  value: Buffer; // BigInt

  type: Hex;
  gasPrice: Buffer | null; // BigInt
  maxFeePerGas: Buffer | null; // BigInt
  maxPriorityFeePerGas: Buffer | null; // BigInt
  accessList: string | null;

  chainId: number;
};

export type InsertableTransaction = Insertable<TransactionsTable>;

export function rpcToSqliteTransaction(
  transaction: RpcTransaction
): Omit<InsertableTransaction, "chainId"> {
  return {
    accessList: transaction.accessList
      ? JSON.stringify(transaction.accessList)
      : undefined,
    blockHash: transaction.blockHash!,
    blockNumber: intToBlob(transaction.blockNumber!),
    from: transaction.from,
    gas: intToBlob(transaction.gas),
    gasPrice: transaction.gasPrice ? intToBlob(transaction.gasPrice) : null,
    hash: transaction.hash,
    input: transaction.input,
    maxFeePerGas: transaction.maxFeePerGas
      ? intToBlob(transaction.maxFeePerGas)
      : null,
    maxPriorityFeePerGas: transaction.maxPriorityFeePerGas
      ? intToBlob(transaction.maxPriorityFeePerGas)
      : null,
    nonce: hexToNumber(transaction.nonce),
    r: transaction.r,
    s: transaction.s,
    to: transaction.to ? transaction.to : null,
    transactionIndex: Number(transaction.transactionIndex),
    type: transaction.type ?? "0x0",
    value: intToBlob(transaction.value),
    v: intToBlob(transaction.v),
  };
}

type LogsTable = {
  id: string;
  address: Address;
  blockHash: Hash;
  blockNumber: Buffer; // BigInt
  data: Hex;
  logIndex: number;
  transactionHash: Hash;
  transactionIndex: number;

  topic0: string | null;
  topic1: string | null;
  topic2: string | null;
  topic3: string | null;

  chainId: number;
};

export type InsertableLog = Insertable<LogsTable>;

export function rpcToSqliteLog(log: RpcLog): Omit<InsertableLog, "chainId"> {
  return {
    address: log.address,
    blockHash: log.blockHash!,
    blockNumber: intToBlob(log.blockNumber!),
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

type ContractReadResultsTable = {
  address: string;
  blockNumber: Buffer; // BigInt
  chainId: number;
  data: Hex;
  result: Hex;
};

type LogFilterCachedRangesTable = {
  id: Generated<number>;
  filterKey: string;
  startBlock: Buffer; // BigInt
  endBlock: Buffer; // BigInt
  endBlockTimestamp: Buffer; // BigInt
};

type LogFiltersTable = {
  id: Generated<number>;
  chainId: number;
  address: Hex | null;
  topic0: Hex | null;
  topic1: Hex | null;
  topic2: Hex | null;
  topic3: Hex | null;
};

type LogFilterRangesTable = {
  id: Generated<number>;
  logFilterId: number;
  startBlock: bigint;
  endBlock: bigint;
  endBlockTimestamp: bigint;
};

export type EventStoreTables = {
  blocks: BlocksTable;
  transactions: TransactionsTable;
  logs: LogsTable;
  contractReadResults: ContractReadResultsTable;
  logFilterCachedRanges: LogFilterCachedRangesTable;

  logFilters: LogFiltersTable;
  logFilterRanges: LogFilterRangesTable;
};
