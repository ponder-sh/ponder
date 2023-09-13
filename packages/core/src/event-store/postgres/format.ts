import type { Generated, Insertable } from "kysely";
import type { Address, Hash, Hex } from "viem";
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
  mixHash: Hash;
  nonce: Hex;
  number: bigint;
  parentHash: Hash;
  receiptsRoot: Hex;
  sha3Uncles: Hash;
  size: bigint;
  stateRoot: Hash;
  timestamp: bigint;
  totalDifficulty: bigint;
  transactionsRoot: Hash;

  chainId: number;
};

export type InsertableBlock = Insertable<BlocksTable>;

export function rpcToPostgresBlock(
  block: RpcBlock
): Omit<InsertableBlock, "chainId"> {
  return {
    baseFeePerGas: block.baseFeePerGas ? BigInt(block.baseFeePerGas) : null,
    difficulty: BigInt(block.difficulty),
    extraData: block.extraData,
    gasLimit: BigInt(block.gasLimit),
    gasUsed: BigInt(block.gasUsed),
    hash: block.hash!,
    logsBloom: block.logsBloom!,
    miner: block.miner,
    mixHash: block.mixHash,
    nonce: block.nonce!,
    number: BigInt(block.number!),
    parentHash: block.parentHash,
    receiptsRoot: block.receiptsRoot,
    sha3Uncles: block.sha3Uncles,
    size: BigInt(block.size),
    stateRoot: block.stateRoot,
    timestamp: BigInt(block.timestamp),
    totalDifficulty: BigInt(block.totalDifficulty!),
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
  r: Hex;
  s: Hex;
  to: Address | null;
  transactionIndex: number;
  v: bigint;
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
  transaction: RpcTransaction
): Omit<InsertableTransaction, "chainId"> {
  return {
    accessList: transaction.accessList
      ? JSON.stringify(transaction.accessList)
      : undefined,
    blockHash: transaction.blockHash!,
    blockNumber: BigInt(transaction.blockNumber!),
    from: transaction.from,
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
    r: transaction.r,
    s: transaction.s,
    to: transaction.to ? transaction.to : null,
    transactionIndex: Number(transaction.transactionIndex),
    type: transaction.type ?? "0x0",
    value: BigInt(transaction.value),
    v: BigInt(transaction.v),
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

  topic0: string | null;
  topic1: string | null;
  topic2: string | null;
  topic3: string | null;

  chainId: number;
};

export type InsertableLog = Insertable<LogsTable>;

export function rpcToPostgresLog(log: RpcLog): Omit<InsertableLog, "chainId"> {
  return {
    address: log.address,
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

type ContractReadResultsTable = {
  address: string;
  blockNumber: bigint;
  chainId: number;
  data: Hex;
  result: Hex;
};

type LogFilterCachedRangesTable = {
  id: Generated<number>;
  filterKey: string;
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
};
