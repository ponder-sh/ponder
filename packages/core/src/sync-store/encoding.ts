import type { FragmentId } from "@/sync/fragments.js";
import type {
  SyncBlock,
  SyncLog,
  SyncTrace,
  SyncTransaction,
  SyncTransactionReceipt,
} from "@/types/sync.js";
import { toLowerCase } from "@/utils/lowercase.js";
import type { ColumnType, Insertable } from "kysely";
import type { Address, Hash, Hex } from "viem";
import { hexToBigInt, hexToNumber } from "viem";

type BlocksTable = {
  chain_id: number;
  number: ColumnType<string, string | bigint, string | bigint>;
  hash: Hash;
  parent_hash: Hash;
  timestamp: ColumnType<string, string | bigint, string | bigint>;

  body: any;
  // body: {
  //   receiptsRoot: Hex;
  //   sha3Uncles: Hash | null;
  //   size: string;
  //   stateRoot: Hash;
  //   logsBloom: Hex;
  //   miner: Address;
  //   mixHash: Hash | null;
  //   nonce: Hex | null;
  //   totalDifficulty: string | null;
  //   transactionsRoot: Hash;
  //   difficulty: string;
  //   extraData: Hex;
  //   gasLimit: string;
  //   gasUsed: string;
  //   baseFeePerGas: string | null;
  // };
};

export const encodeBlock = ({
  block,
  chainId,
}: {
  block: SyncBlock;
  chainId: number;
}) => {
  const { number, hash, parentHash, timestamp, ...rest } = block;

  return {
    chain_id: chainId,
    number: hexToBigInt(number),
    hash: hash,
    parent_hash: parentHash,
    timestamp: hexToBigInt(timestamp),

    body: rest,
    // body: {
    //   receiptsRoot: block.receiptsRoot,
    //   sha3Uncles: block.sha3Uncles ?? null,
    //   size: hexToBigInt(block.size).toString(),
    //   stateRoot: block.stateRoot,
    //   logsBloom: block.logsBloom!,
    //   miner: toLowerCase(block.miner),
    //   mixHash: block.mixHash ?? null,
    //   nonce: block.nonce ?? null,
    //   totalDifficulty: block.totalDifficulty
    //     ? hexToBigInt(block.totalDifficulty).toString()
    //     : null,
    //   transactionsRoot: block.transactionsRoot,
    //   difficulty: hexToBigInt(block.difficulty).toString(),
    //   extraData: block.extraData,
    //   gasLimit: hexToBigInt(block.gasLimit).toString(),
    //   gasUsed: hexToBigInt(block.gasUsed).toString(),
    //   baseFeePerGas: block.baseFeePerGas
    //     ? hexToBigInt(block.baseFeePerGas).toString()
    //     : null,
    // },
  } satisfies Insertable<BlocksTable>;
};

type LogsTable = {
  chain_id: number;
  block_number: ColumnType<string, string | bigint, string | bigint>;
  block_hash: Hash;
  transaction_index: number;
  log_index: number;
  address: Address;
  data: Hex;
  topic0: Hex | null;
  topic1: Hex | null;
  topic2: Hex | null;
  topic3: Hex | null;
};

export const encodeLog = ({
  log,
  chainId,
}: {
  log: SyncLog;
  chainId: number;
}) => {
  return {
    chain_id: chainId,
    block_number: hexToBigInt(log.blockNumber),
    block_hash: log.blockHash,
    transaction_index: hexToNumber(log.transactionIndex),
    log_index: hexToNumber(log.logIndex),
    address: toLowerCase(log.address),
    data: log.data,
    topic0: log.topics[0] ? log.topics[0] : null,
    topic1: log.topics[1] ? log.topics[1] : null,
    topic2: log.topics[2] ? log.topics[2] : null,
    topic3: log.topics[3] ? log.topics[3] : null,
  } satisfies Insertable<LogsTable>;
};

type TransactionsTable = {
  chain_id: number;
  block_hash: Hash;
  block_number: ColumnType<string, string | bigint, string | bigint>;
  transaction_index: number;
  hash: Hash;
  from: Address;
  to: Address | null;

  body: any;
  // body: {
  //   gas: string;
  //   gasPrice: string | null;
  //   input: Hex;
  //   maxFeePerGas: string | null;
  //   maxPriorityFeePerGas: string | null;
  //   nonce: number;
  //   r: Hex | null;
  //   s: Hex | null;
  //   type: Hex;
  //   value: string;
  //   v: string | null;
  //   accessList: string | null;
  // };
};

export const encodeTransaction = ({
  transaction,
  chainId,
}: {
  transaction: SyncTransaction;
  chainId: number;
}) => {
  const { blockHash, blockNumber, transactionIndex, hash, from, to, ...rest } =
    transaction;

  return {
    chain_id: chainId,
    block_hash: blockHash,
    block_number: hexToBigInt(blockNumber),
    transaction_index: hexToNumber(transactionIndex),
    hash: hash,
    from: toLowerCase(from),
    to: to ? toLowerCase(to) : null,

    body: rest,
  };
};

type TransactionReceiptsTable = {
  chain_id: number;
  block_hash: Hash;
  block_number: ColumnType<string, string | bigint, string | bigint>;
  transaction_index: number;
  hash: Hash;

  body: any;
  // body: {
  //   from: Address;
  //   to: Address | null;
  //   contractAddress: Address | null;
  //   cumulativeGasUsed: string;
  //   effectiveGasPrice: string;
  //   gasUsed: string;
  //   logsBloom: Hex;
  //   status: Hex;
  // };
};

export const encodeTransactionReceipt = ({
  transactionReceipt,
  chainId,
}: {
  transactionReceipt: SyncTransactionReceipt;
  chainId: number;
}) => {
  const {
    blockHash,
    blockNumber,
    transactionIndex,
    transactionHash,
    logs, // Not included in the table
    ...rest
  } = transactionReceipt;

  return {
    chain_id: chainId,
    block_hash: blockHash,
    block_number: hexToBigInt(blockNumber),
    transaction_index: hexToNumber(transactionIndex),
    hash: transactionHash,

    body: rest,
  };
};

type TracesTable = {
  chain_id: number;
  block_hash: Hash;
  block_number: ColumnType<string, string | bigint, string | bigint>;
  transaction_index: number;
  trace_index: number;
  from: Address;
  to: Address | null;
  type: string;
  function_selector: string;
  value: ColumnType<string, string | bigint, string | bigint> | null;
  is_reverted: number;

  body: any;
  // body: {
  //   gas: string;
  //   gasUsed: string;
  //   input: Hex;
  //   output: Hex | null;
  //   error: string | null;
  //   revertReason: string | null;
  //   subcalls: number;
  // };
};

export function encodeTrace({
  trace,
  block,
  transaction,
  chainId,
}: {
  trace: Omit<SyncTrace["trace"], "calls" | "logs">;
  block: Pick<SyncBlock, "hash" | "number">;
  transaction: Pick<SyncTransaction, "transactionIndex">;
  chainId: number;
}) {
  const { index, from, to, type, value, ...rest } = trace;

  return {
    chain_id: chainId,
    block_hash: block.hash,
    block_number: hexToBigInt(block.number),
    transaction_index: hexToNumber(transaction.transactionIndex),
    trace_index: index,
    from: toLowerCase(from),
    to: to ? toLowerCase(to) : null,
    type: type,
    value: value ? hexToBigInt(value) : null,
    function_selector: trace.input.slice(0, 10),
    is_reverted: trace.error === undefined ? 0 : 1,

    body: rest,
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
  transaction_receipts: TransactionReceiptsTable;
  traces: TracesTable;
  rpc_request_results: RpcRequestResultsTable;
  intervals: IntervalTable;
};
