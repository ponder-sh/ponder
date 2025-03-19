import type {
  DbBlock,
  DbLog,
  DbTrace,
  DbTransaction,
  DbTransactionReceipt,
  Factory,
  FragmentId,
  InternalBlock,
  InternalLog,
  InternalTrace,
  InternalTransaction,
  InternalTransactionReceipt,
  SyncBlock,
  SyncLog,
  SyncTrace,
  SyncTransaction,
  SyncTransactionReceipt,
} from "@/internal/types.js";
import type { Trace } from "@/types/eth.js";
import { toLowerCase } from "@/utils/lowercase.js";
import type { ColumnType, Insertable } from "kysely";
import type { Address, Hash, Hex, TransactionReceipt } from "viem";
import { hexToBigInt, hexToNumber } from "viem";

type PgNumeric = ColumnType<string, string | bigint, string | bigint>;
type PgInt8 = ColumnType<string, string | number, string | number>;

type BlocksTable = {
  chain_id: PgInt8;
  number: PgInt8;
  timestamp: PgInt8;
  hash: Hash;
  parent_hash: Hash;
  logs_bloom: Hex;
  miner: Address;
  gas_used: PgNumeric;
  gas_limit: PgNumeric;
  base_fee_per_gas: PgNumeric | null;
  nonce: Hex | null;
  mix_hash: Hash | null;
  state_root: Hash;
  receipts_root: Hash;
  transactions_root: Hash;
  sha3_uncles: Hash | null;
  size: PgNumeric;
  difficulty: PgNumeric;
  total_difficulty: PgNumeric | null;
  extra_data: Hex;
};

export const encodeBlock = ({
  block,
  chainId,
}: { block: SyncBlock; chainId: number }): Insertable<BlocksTable> => ({
  chain_id: chainId,
  number: hexToNumber(block.number),
  timestamp: hexToNumber(block.timestamp),
  hash: block.hash,
  parent_hash: block.parentHash,
  logs_bloom: block.logsBloom!,
  miner: toLowerCase(block.miner),
  gas_used: hexToBigInt(block.gasUsed),
  gas_limit: hexToBigInt(block.gasLimit),
  base_fee_per_gas: block.baseFeePerGas
    ? hexToBigInt(block.baseFeePerGas)
    : null,
  nonce: block.nonce ?? null,
  mix_hash: block.mixHash ?? null,
  state_root: block.stateRoot,
  receipts_root: block.receiptsRoot,
  transactions_root: block.transactionsRoot,
  sha3_uncles: block.sha3Uncles ?? null,
  size: hexToBigInt(block.size),
  difficulty: hexToBigInt(block.difficulty),
  total_difficulty: block.totalDifficulty
    ? hexToBigInt(block.totalDifficulty)
    : null,
  extra_data: block.extraData,
});

export const decodeBlock = ({ block }: { block: DbBlock }): InternalBlock => ({
  number: BigInt(block.number),
  timestamp: BigInt(block.timestamp),
  hash: block.hash,
  parentHash: block.parent_hash,
  logsBloom: block.logs_bloom,
  miner: block.miner,
  gasUsed: BigInt(block.gas_used),
  gasLimit: BigInt(block.gas_limit),
  baseFeePerGas: block.base_fee_per_gas ? BigInt(block.base_fee_per_gas) : null,
  nonce: block.nonce,
  mixHash: block.mix_hash,
  stateRoot: block.state_root,
  receiptsRoot: block.receipts_root,
  transactionsRoot: block.transactions_root,
  sha3Uncles: block.sha3_uncles,
  size: BigInt(block.size),
  difficulty: BigInt(block.difficulty),
  totalDifficulty: block.total_difficulty
    ? BigInt(block.total_difficulty)
    : null,
  extraData: block.extra_data,
});

type LogsTable = {
  chain_id: PgInt8;
  block_number: PgInt8;
  log_index: number;
  transaction_index: number;
  block_hash: Hash;
  transaction_hash: Hash;
  address: Address;
  topic0: Hex | null;
  topic1: Hex | null;
  topic2: Hex | null;
  topic3: Hex | null;
  data: Hex;
};

export const encodeLog = ({
  log,
  chainId,
}: { log: SyncLog; chainId: number }): Insertable<LogsTable> => ({
  chain_id: chainId,
  block_number: hexToNumber(log.blockNumber),
  log_index: hexToNumber(log.logIndex),
  transaction_index: hexToNumber(log.transactionIndex),
  block_hash: log.blockHash,
  transaction_hash: log.transactionHash,
  address: toLowerCase(log.address),
  topic0: log.topics[0] ? log.topics[0] : null,
  topic1: log.topics[1] ? log.topics[1] : null,
  topic2: log.topics[2] ? log.topics[2] : null,
  topic3: log.topics[3] ? log.topics[3] : null,
  data: log.data,
});

export const decodeLog = ({ log }: { log: DbLog }): InternalLog => ({
  address: log.address,
  topics: [
    // @ts-ignore
    log.topic0,
    log.topic1,
    log.topic2,
    log.topic3,
  ],
  data: log.data,
  logIndex: log.log_index,
  removed: false,
  blockNumber: Number(log.block_number),
  transactionIndex: log.transaction_index,
});

type TransactionsTable = {
  chain_id: PgInt8;
  block_number: PgInt8;
  transaction_index: number;
  hash: Hash;
  block_hash: Hash;
  from: Address;
  to: Address | null;
  input: Hex;
  value: PgNumeric;
  nonce: number;
  r: Hex | null;
  s: Hex | null;
  v: PgNumeric | null;
  type: Hex;
  gas: PgNumeric;
  gas_price: PgNumeric | null;
  max_fee_per_gas: PgNumeric | null;
  max_priority_fee_per_gas: PgNumeric | null;
  access_list: string | null;
};

export const encodeTransaction = ({
  transaction,
  chainId,
}: {
  transaction: SyncTransaction;
  chainId: number;
}): Insertable<TransactionsTable> => ({
  chain_id: chainId,
  block_number: hexToNumber(transaction.blockNumber),
  transaction_index: hexToNumber(transaction.transactionIndex),
  hash: transaction.hash,
  block_hash: transaction.blockHash,
  from: toLowerCase(transaction.from),
  to: transaction.to ? toLowerCase(transaction.to) : null,
  input: transaction.input,
  value: hexToBigInt(transaction.value),
  nonce: hexToNumber(transaction.nonce),
  r: transaction.r ?? null,
  s: transaction.s ?? null,
  v: transaction.v ? hexToBigInt(transaction.v) : null,
  type: transaction.type ?? "0x0",
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
});

export const decodeTransaction = ({
  transaction,
}: { transaction: DbTransaction }): InternalTransaction => ({
  blockNumber: Number(transaction.block_number),
  transactionIndex: transaction.transaction_index,
  hash: transaction.hash,
  from: transaction.from,
  to: transaction.to,
  input: transaction.input,
  value: BigInt(transaction.value),
  nonce: transaction.nonce,
  r: transaction.r,
  s: transaction.s,
  v: transaction.v ? BigInt(transaction.v) : null,
  gas: BigInt(transaction.gas),
  ...(transaction.type === "0x0"
    ? {
        type: "legacy",
        gasPrice: BigInt(transaction.gas_price!),
      }
    : transaction.type === "0x1"
      ? {
          type: "eip2930",
          gasPrice: BigInt(transaction.gas_price!),
          accessList: JSON.parse(transaction.access_list!),
        }
      : transaction.type === "0x2"
        ? {
            type: "eip1559",
            maxFeePerGas: BigInt(transaction.max_fee_per_gas!),
            maxPriorityFeePerGas: BigInt(transaction.max_priority_fee_per_gas!),
          }
        : transaction.type === "0x7e"
          ? {
              type: "deposit",
              maxFeePerGas:
                transaction.max_fee_per_gas !== null
                  ? BigInt(transaction.max_fee_per_gas)
                  : undefined,
              maxPriorityFeePerGas:
                transaction.max_priority_fee_per_gas !== null
                  ? BigInt(transaction.max_priority_fee_per_gas)
                  : undefined,
            }
          : {
              type: transaction.type,
            }),
});

type TransactionReceiptsTable = {
  chain_id: PgInt8;
  block_number: PgInt8;
  transaction_index: number;
  transaction_hash: Hash;
  block_hash: Hash;
  from: Address;
  to: Address | null;
  contract_address: Address | null;
  logs_bloom: Hex;
  gas_used: PgNumeric;
  cumulative_gas_used: PgNumeric;
  effective_gas_price: PgNumeric;
  status: Hex;
  type: Hex;
};

export const encodeTransactionReceipt = ({
  transactionReceipt,
  chainId,
}: {
  transactionReceipt: SyncTransactionReceipt;
  chainId: number;
}): Insertable<TransactionReceiptsTable> => ({
  chain_id: chainId,
  block_number: hexToNumber(transactionReceipt.blockNumber),
  transaction_index: hexToNumber(transactionReceipt.transactionIndex),
  transaction_hash: transactionReceipt.transactionHash,
  block_hash: transactionReceipt.blockHash,
  from: toLowerCase(transactionReceipt.from),
  to: transactionReceipt.to ? toLowerCase(transactionReceipt.to) : null,
  contract_address: transactionReceipt.contractAddress
    ? toLowerCase(transactionReceipt.contractAddress)
    : null,
  logs_bloom: transactionReceipt.logsBloom,
  gas_used: hexToBigInt(transactionReceipt.gasUsed),
  cumulative_gas_used: hexToBigInt(transactionReceipt.cumulativeGasUsed),
  effective_gas_price: hexToBigInt(transactionReceipt.effectiveGasPrice),
  status: transactionReceipt.status,
  type: transactionReceipt.type as Hex,
});

export const decodeTransactionReceipt = ({
  transactionReceipt,
}: {
  transactionReceipt: DbTransactionReceipt;
}): InternalTransactionReceipt => ({
  blockNumber: Number(transactionReceipt.block_number),
  transactionIndex: transactionReceipt.transaction_index,
  from: transactionReceipt.from,
  to: transactionReceipt.to,
  contractAddress: transactionReceipt.contract_address,
  logsBloom: transactionReceipt.logs_bloom,
  gasUsed: BigInt(transactionReceipt.gas_used),
  cumulativeGasUsed: BigInt(transactionReceipt.cumulative_gas_used),
  effectiveGasPrice: BigInt(transactionReceipt.effective_gas_price),
  status:
    transactionReceipt.status === "0x1"
      ? "success"
      : transactionReceipt.status === "0x0"
        ? "reverted"
        : (transactionReceipt.status as TransactionReceipt["status"]),
  type:
    transactionReceipt.type === "0x0"
      ? "legacy"
      : transactionReceipt.type === "0x1"
        ? "eip2930"
        : transactionReceipt.type === "0x2"
          ? "eip1559"
          : transactionReceipt.type === "0x7e"
            ? "deposit"
            : transactionReceipt.type,
});

type TracesTable = {
  chain_id: PgInt8;
  block_number: PgInt8;
  transaction_index: number;
  trace_index: number;
  from: Address;
  to: Address | null;
  input: Hex;
  output: Hex | null;
  value: PgNumeric | null;
  type: string;
  gas: PgNumeric;
  gas_used: PgNumeric;
  error: string | null;
  revert_reason: string | null;
  subcalls: number;
};

export const encodeTrace = ({
  trace,
  block,
  transaction,
  chainId,
}: {
  trace: SyncTrace;
  block: Pick<SyncBlock, "number">;
  transaction: Pick<SyncTransaction, "transactionIndex">;
  chainId: number;
}): Insertable<TracesTable> => ({
  chain_id: chainId,
  block_number: hexToNumber(block.number),
  transaction_index: hexToNumber(transaction.transactionIndex),
  trace_index: trace.trace.index,
  from: toLowerCase(trace.trace.from),
  to: trace.trace.to ? toLowerCase(trace.trace.to) : null,
  input: trace.trace.input,
  output: trace.trace.output ?? null,
  value: trace.trace.value ? hexToBigInt(trace.trace.value) : null,
  type: trace.trace.type,
  gas: hexToBigInt(trace.trace.gas),
  gas_used: hexToBigInt(trace.trace.gasUsed),
  error: trace.trace.error ?? null,
  revert_reason: trace.trace.revertReason ?? null,
  subcalls: trace.trace.subcalls,
});

export const decodeTrace = ({ trace }: { trace: DbTrace }): InternalTrace => ({
  blockNumber: Number(trace.block_number),
  traceIndex: trace.trace_index,
  transactionIndex: trace.transaction_index,
  from: trace.from,
  to: trace.to,
  input: trace.input,
  output: trace.output ?? undefined,
  value: trace.value ? BigInt(trace.value) : null,
  type: trace.type as Trace["type"],
  gas: BigInt(trace.gas),
  gasUsed: BigInt(trace.gas_used),
  error: trace.error ? trace.error.replace(/\0/g, "") : undefined,
  revertReason: trace.revert_reason
    ? trace.revert_reason.replace(/\0/g, "")
    : undefined,
  subcalls: trace.subcalls,
});

type IntervalTable = {
  fragment_id: FragmentId;
  chain_id: PgInt8;
  blocks: string;
};

type RpcRequestResultsTable = {
  request_hash: string;
  chain_id: PgInt8;
  block_number: PgInt8 | undefined;
  result: string;
};

type FactoriesTable = {
  id: ColumnType<number, undefined>;
  factory: Factory;
};

type FactoryAddressesTable = {
  id: ColumnType<number, undefined>;
  factory_id: number; // references `factories.id`
  chain_id: PgInt8;
  block_number: PgInt8;
  address: Address;
};

export type PonderSyncSchema = {
  blocks: BlocksTable;
  logs: LogsTable;
  transactions: TransactionsTable;
  transaction_receipts: TransactionReceiptsTable;
  traces: TracesTable;

  rpc_request_results: RpcRequestResultsTable;
  intervals: IntervalTable;
  factories: FactoriesTable;
  factory_addresses: FactoryAddressesTable;
};
