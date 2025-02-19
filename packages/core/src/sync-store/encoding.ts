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
import type { Address, Hex } from "viem";
import { hexToBigInt, hexToNumber } from "viem";

type Numeric78 = ColumnType<string, string | bigint, string | bigint>;
type Numeric78OrNull = ColumnType<
  string | null,
  string | bigint | null,
  string | bigint | null
>;

type BlockTable = {
  chain_id: number;
  checkpoint: string;
  number: Numeric78;
  hash: Hex;
  parent_hash: Hex;
  timestamp: Numeric78;
  base_fee_per_gas: Numeric78OrNull;
  difficulty: Numeric78;
  extra_data: Hex;
  gas_limit: Numeric78;
  gas_used: Numeric78;
  logs_bloom: Hex;
  miner: Address;
  mix_hash: Hex | null;
  nonce: Hex | null;
  receipts_root: Hex;
  sha3_uncles: Hex | null;
  size: Numeric78;
  state_root: Hex;
  total_difficulty: Numeric78OrNull;
  transactions_root: Hex;
};

export function encodeBlock({
  block,
  chainId,
}: {
  block: SyncBlock;
  chainId: number;
}): Insertable<BlockTable> {
  return {
    chain_id: chainId,
    checkpoint: encodeCheckpoint({
      blockTimestamp: hexToNumber(block.timestamp),
      chainId: BigInt(chainId),
      blockNumber: hexToBigInt(block.number),
      transactionIndex: MAX_CHECKPOINT.transactionIndex,
      eventType: EVENT_TYPES.blocks,
      eventIndex: ZERO_CHECKPOINT.eventIndex,
    }),
    number: hexToBigInt(block.number),
    hash: block.hash,
    parent_hash: block.parentHash,
    timestamp: hexToBigInt(block.timestamp),
    base_fee_per_gas: block.baseFeePerGas
      ? hexToBigInt(block.baseFeePerGas)
      : null,
    difficulty: hexToBigInt(block.difficulty),
    extra_data: block.extraData,
    gas_limit: hexToBigInt(block.gasLimit),
    gas_used: hexToBigInt(block.gasUsed),
    logs_bloom: block.logsBloom,
    miner: toLowerCase(block.miner),
    mix_hash: block.mixHash ?? null,
    nonce: block.nonce ?? null,
    receipts_root: block.receiptsRoot,
    sha3_uncles: block.sha3Uncles ?? null,
    size: hexToBigInt(block.size),
    state_root: block.stateRoot,
    total_difficulty: block.totalDifficulty
      ? hexToBigInt(block.totalDifficulty)
      : null,
    transactions_root: block.transactionsRoot,
  };
}

type LogTable = {
  chain_id: number;
  checkpoint: string;
  block_number: Numeric78;
  block_hash: Hex;
  transaction_index: number;
  transaction_hash: Hex;
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
  block,
  chainId,
}: {
  log: SyncLog;
  block: SyncBlock;
  chainId: number;
}): Insertable<LogTable> => {
  return {
    chain_id: chainId,
    checkpoint: encodeCheckpoint({
      blockTimestamp: hexToNumber(block.timestamp),
      chainId: BigInt(chainId),
      blockNumber: hexToBigInt(log.blockNumber),
      transactionIndex: hexToBigInt(log.transactionIndex),
      eventType: EVENT_TYPES.logs,
      eventIndex: hexToBigInt(log.logIndex),
    }),
    block_number: hexToBigInt(log.blockNumber),
    block_hash: log.blockHash,
    log_index: hexToNumber(log.logIndex),
    transaction_hash: log.transactionHash,
    transaction_index: hexToNumber(log.transactionIndex),
    address: toLowerCase(log.address),
    topic0: log.topics[0] ? log.topics[0] : null,
    topic1: log.topics[1] ? log.topics[1] : null,
    topic2: log.topics[2] ? log.topics[2] : null,
    topic3: log.topics[3] ? log.topics[3] : null,
    data: log.data,
  };
};

type TransactionTable = {
  chain_id: number;
  checkpoint: string;
  block_number: Numeric78;
  block_hash: Hex;
  transaction_index: number;
  transaction_hash: Hex;
  from: Address;
  to: Address | null;
  type: Hex;
  value: Numeric78;
  input: Hex;
  nonce: number;
  gas: Numeric78;
  gas_price: Numeric78OrNull;
  max_fee_per_gas: Numeric78OrNull;
  max_priority_fee_per_gas: Numeric78OrNull;
  access_list: string | null;
  r: Hex | null;
  s: Hex | null;
  v: ColumnType<string | null, string | bigint | null, string | bigint | null>;
};

export function encodeTransaction({
  transaction,
  block,
  chainId,
}: {
  transaction: SyncTransaction;
  block: Pick<SyncBlock, "timestamp">;
  chainId: number;
}): Insertable<TransactionTable> {
  return {
    chain_id: chainId,
    checkpoint: encodeCheckpoint({
      blockTimestamp: hexToNumber(block.timestamp),
      chainId: BigInt(chainId),
      blockNumber: hexToBigInt(transaction.blockNumber),
      transactionIndex: hexToBigInt(transaction.transactionIndex),
      eventType: EVENT_TYPES.transactions,
      eventIndex: ZERO_CHECKPOINT.eventIndex,
    }),
    block_number: hexToBigInt(transaction.blockNumber),
    block_hash: transaction.blockHash,
    transaction_index: hexToNumber(transaction.transactionIndex),
    transaction_hash: transaction.hash,
    from: toLowerCase(transaction.from),
    to: transaction.to ? toLowerCase(transaction.to) : null,
    type: transaction.type,
    value: hexToBigInt(transaction.value),
    input: transaction.input,
    nonce: hexToNumber(transaction.nonce),
    gas: hexToBigInt(transaction.gas),
    gas_price: transaction.gasPrice ? hexToBigInt(transaction.gasPrice) : null,
    max_fee_per_gas: transaction.maxFeePerGas
      ? hexToBigInt(transaction.maxFeePerGas)
      : null,
    max_priority_fee_per_gas: transaction.maxPriorityFeePerGas
      ? hexToBigInt(transaction.maxPriorityFeePerGas)
      : null,
    access_list: transaction.accessList
      ? JSON.stringify(transaction.accessList)
      : null,
    r: transaction.r ?? null,
    s: transaction.s ?? null,
    v: transaction.v ? hexToBigInt(transaction.v) : null,
  };
}

type TransactionReceiptTable = {
  chain_id: number;
  block_number: Numeric78;
  transaction_index: number;
  block_hash: Hex;
  transaction_hash: Hex;
  from: Address;
  to: Address | null;
  contract_address: Address | null;
  status: Hex;
  type: Hex;
  gas_used: Numeric78;
  cumulative_gas_used: Numeric78;
  effective_gas_price: Numeric78;
  logs_bloom: Hex;
};

export const encodeTransactionReceipt = ({
  transactionReceipt,
  chainId,
}: {
  transactionReceipt: SyncTransactionReceipt;
  chainId: number;
}): Insertable<TransactionReceiptTable> => {
  return {
    chain_id: chainId,
    block_hash: transactionReceipt.blockHash,
    block_number: hexToBigInt(transactionReceipt.blockNumber),
    contract_address: transactionReceipt.contractAddress
      ? toLowerCase(transactionReceipt.contractAddress)
      : null,
    cumulative_gas_used: hexToBigInt(transactionReceipt.cumulativeGasUsed),
    effective_gas_price: hexToBigInt(transactionReceipt.effectiveGasPrice),
    from: toLowerCase(transactionReceipt.from),
    gas_used: hexToBigInt(transactionReceipt.gasUsed),
    logs_bloom: transactionReceipt.logsBloom,
    status: transactionReceipt.status,
    to: transactionReceipt.to ? toLowerCase(transactionReceipt.to) : null,
    transaction_hash: transactionReceipt.transactionHash,
    transaction_index: hexToNumber(transactionReceipt.transactionIndex),
    type: transactionReceipt.type as Hex,
  };
};

type TraceTable = {
  chain_id: number;
  checkpoint: string;
  block_number: Numeric78;
  block_hash: Hex;
  transaction_index: number;
  transaction_hash: Hex;
  trace_index: number;
  from: Address;
  to: Address | null;
  value: Numeric78OrNull;
  type: string;
  function_selector: Hex;
  is_reverted: number;
  gas: Numeric78;
  gas_used: Numeric78;
  input: Hex;
  output: Hex | null;
  error: string | null;
  revert_reason: string | null;
  subcalls: number;
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
}): Insertable<TraceTable> {
  return {
    chain_id: chainId,
    checkpoint: encodeCheckpoint({
      blockTimestamp: hexToNumber(block.timestamp),
      chainId: BigInt(chainId),
      blockNumber: hexToBigInt(block.number),
      transactionIndex: hexToBigInt(transaction.transactionIndex),
      eventType: EVENT_TYPES.traces,
      eventIndex: BigInt(trace.index),
    }),
    block_number: hexToBigInt(block.number),
    block_hash: block.hash,
    transaction_index: hexToNumber(transaction.transactionIndex),
    transaction_hash: transaction.hash,
    trace_index: trace.index,
    from: toLowerCase(trace.from),
    to: trace.to ? toLowerCase(trace.to) : null,
    value: trace.value ? hexToBigInt(trace.value) : null,
    type: trace.type,
    function_selector: trace.input.slice(0, 10) as Hex,
    is_reverted: trace.error === undefined ? 0 : 1,
    gas: hexToBigInt(trace.gas),
    gas_used: hexToBigInt(trace.gasUsed),
    input: trace.input,
    output: trace.output ?? null,
    error: trace.error ? trace.error.replace(/\0/g, "") : null,
    revert_reason: trace.revertReason
      ? trace.revertReason.replace(/\0/g, "")
      : null,
    subcalls: trace.subcalls,
  };
}

type RpcRequestResultsTable = {
  request: string;
  request_hash: ColumnType<string, undefined>;
  chain_id: number;
  block_number: Numeric78OrNull;
  result: string;
};

type IntervalTable = {
  fragment_id: FragmentId;
  chain_id: number;
  blocks: string;
};

///  WIP FACTORY DESIGN ///

// type FactoryTable = {
//   integer_id: Generated<number>;
//   factory_id: string;
// };

// type FactoryAddressTable = {
//   id: Generated<number>;
//   factory_integer_id: number;
//   address: string;
//   block_number: Numeric78
// };

export type PonderSyncSchema = {
  intervals: IntervalTable;
  rpc_request_results: RpcRequestResultsTable;

  block: BlockTable;
  log: LogTable;
  transaction: TransactionTable;
  transaction_receipt: TransactionReceiptTable;
  trace: TraceTable;

  // factory: FactoryTable;
  // factory_address: FactoryAddressTable;
};
