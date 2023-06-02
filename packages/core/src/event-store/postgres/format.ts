import { Generated, Insertable, Selectable } from "kysely";
import {
  type RpcBlock,
  type RpcLog,
  type RpcTransaction,
  hexToNumber,
  transactionType,
} from "viem";
import { Address, Hash, Hex } from "viem";

type BlocksTable = {
  baseFeePerGas: Hex | null; // BigInt
  difficulty: Hex; // BigInt
  extraData: Hex;
  gasLimit: Hex; // BigInt
  gasUsed: Hex; // BigInt
  hash: Hash;
  logsBloom: Hex;
  miner: Address;
  mixHash: Hash;
  nonce: Hex;
  number: Hex; // BigInt
  parentHash: Hash;
  receiptsRoot: Hex;
  sha3Uncles: Hash;
  size: Hex; // BigInt
  stateRoot: Hash;
  // NOTE: Should be a `bigint` to match viem, but using `number`
  // to make comparison operators work in store.getLogEvents.
  timestamp: number;
  totalDifficulty: Hex; // BigInt
  transactionsRoot: Hash;

  chainId: number;
  finalized: number;
};

export type InsertableBlock = Insertable<BlocksTable>;

export function rpcToPostgresBlock(
  block: RpcBlock
): Omit<InsertableBlock, "chainId" | "finalized"> {
  return {
    baseFeePerGas: block.baseFeePerGas,
    difficulty: block.difficulty,
    extraData: block.extraData,
    gasLimit: block.gasLimit,
    gasUsed: block.gasUsed,
    hash: block.hash!,
    logsBloom: block.logsBloom!,
    miner: block.miner,
    mixHash: block.mixHash,
    nonce: block.nonce!,
    number: block.number!,
    parentHash: block.parentHash,
    receiptsRoot: block.receiptsRoot,
    sha3Uncles: block.sha3Uncles,
    size: block.size,
    stateRoot: block.stateRoot,
    timestamp: hexToNumber(block.timestamp),
    totalDifficulty: block.totalDifficulty!,
    transactionsRoot: block.transactionsRoot,
  };
}

type TransactionsTable = {
  blockHash: Hash;
  blockNumber: Hex; // BigInt
  from: Address;
  gas: Hex; // BigInt
  hash: Hash;
  input: Hex;
  nonce: number;
  r: Hex;
  s: Hex;
  to: Address | null;
  transactionIndex: number;
  v: Hex; // BigInt
  value: Hex; // BigInt

  type: "legacy" | "eip2930" | "eip1559";
  gasPrice: Hex | null; // BigInt
  maxFeePerGas: Hex | null; // BigInt
  maxPriorityFeePerGas: Hex | null; // BigInt
  accessList: string | null;

  chainId: number;
  finalized: number;
};

export type InsertableTransaction = Insertable<TransactionsTable>;

export function rpcToPostgresTransaction(
  transaction: RpcTransaction
): Omit<InsertableTransaction, "chainId" | "finalized"> {
  return {
    accessList: transaction.accessList
      ? JSON.stringify(transaction.accessList)
      : undefined,
    blockHash: transaction.blockHash!,
    blockNumber: transaction.blockNumber!,
    from: transaction.from,
    gas: transaction.gas,
    gasPrice: transaction.gasPrice,
    hash: transaction.hash,
    input: transaction.input,
    maxFeePerGas: transaction.maxFeePerGas,
    maxPriorityFeePerGas: transaction.maxPriorityFeePerGas,
    nonce: hexToNumber(transaction.nonce),
    r: transaction.r,
    s: transaction.s,
    to: transaction.to ? transaction.to : null,
    transactionIndex: Number(transaction.transactionIndex),
    type: transactionType[transaction.type],
    value: transaction.value,
    v: transaction.v,
  };
}

type LogsTable = {
  id: string;
  address: Address;
  blockHash: Hash;
  blockNumber: Hex; // BigInt
  data: Hex;
  logIndex: number;
  transactionHash: Hash;
  transactionIndex: number;

  topic0: string | null;
  topic1: string | null;
  topic2: string | null;
  topic3: string | null;

  chainId: number;
  finalized: number;
};

export type InsertableLog = Insertable<LogsTable>;

export function rpcToPostgresLog({
  log,
}: {
  log: RpcLog;
}): Omit<InsertableLog, "chainId" | "finalized"> {
  return {
    address: log.address,
    blockHash: log.blockHash!,
    blockNumber: log.blockNumber!,
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
  blockNumber: string;
  chainId: number;
  data: string;
  finalized: number; // Boolean (0 or 1).
  result: string;
};

type LogFilterCachedRangesTable = {
  id: Generated<number>;
  filterKey: string;
  startBlock: Hex; // BigInt
  endBlock: Hex; // BigInt
  endBlockTimestamp: Hex; // BigInt
};

export type LogFilterCachedRange = Omit<
  Selectable<LogFilterCachedRangesTable>,
  "id"
>;

export type EventStoreTables = {
  blocks: BlocksTable;
  transactions: TransactionsTable;
  logs: LogsTable;
  contractReadResults: ContractReadResultsTable;
  logFilterCachedRanges: LogFilterCachedRangesTable;
};
