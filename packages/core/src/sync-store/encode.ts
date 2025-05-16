import type {
  SyncBlock,
  SyncLog,
  SyncTrace,
  SyncTransaction,
  SyncTransactionReceipt,
} from "@/internal/types.js";
import { toLowerCase } from "@/utils/lowercase.js";
import type { Hex } from "viem";
import { hexToBigInt, hexToNumber } from "viem";
import type * as ponderSyncSchema from "./schema.js";

export const encodeBlock = ({
  block,
  chainId,
}: {
  block: SyncBlock;
  chainId: number;
}): typeof ponderSyncSchema.blocks.$inferInsert => ({
  chainId: BigInt(chainId),
  number: hexToBigInt(block.number),
  timestamp: hexToBigInt(block.timestamp),
  hash: block.hash,
  parentHash: block.parentHash,
  logsBloom: block.logsBloom!,
  miner: toLowerCase(block.miner),
  gasUsed: hexToBigInt(block.gasUsed),
  gasLimit: hexToBigInt(block.gasLimit),
  baseFeePerGas: block.baseFeePerGas ? hexToBigInt(block.baseFeePerGas) : null,
  nonce: block.nonce ?? null,
  mixHash: block.mixHash ?? null,
  stateRoot: block.stateRoot,
  receiptsRoot: block.receiptsRoot,
  transactionsRoot: block.transactionsRoot,
  sha3Uncles: block.sha3Uncles ?? null,
  size: block.size ? hexToBigInt(block.size) : 0n,
  difficulty: hexToBigInt(block.difficulty),
  totalDifficulty: block.totalDifficulty
    ? hexToBigInt(block.totalDifficulty)
    : null,
  extraData: block.extraData,
});

export const encodeLog = ({
  log,
  chainId,
}: {
  log: SyncLog;
  chainId: number;
}): typeof ponderSyncSchema.logs.$inferInsert => ({
  chainId: BigInt(chainId),
  blockNumber: hexToBigInt(log.blockNumber),
  logIndex: hexToNumber(log.logIndex),
  transactionIndex: hexToNumber(log.transactionIndex),
  blockHash: log.blockHash,
  transactionHash: log.transactionHash,
  address: toLowerCase(log.address),
  topic0: log.topics[0] ? log.topics[0] : null,
  topic1: log.topics[1] ? log.topics[1] : null,
  topic2: log.topics[2] ? log.topics[2] : null,
  topic3: log.topics[3] ? log.topics[3] : null,
  data: log.data,
});

export const encodeTransaction = ({
  transaction,
  chainId,
}: {
  transaction: SyncTransaction;
  chainId: number;
}): typeof ponderSyncSchema.transactions.$inferInsert => ({
  chainId: BigInt(chainId),
  blockNumber: hexToBigInt(transaction.blockNumber),
  transactionIndex: hexToNumber(transaction.transactionIndex),
  hash: transaction.hash,
  blockHash: transaction.blockHash,
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
  gasPrice: transaction.gasPrice ? hexToBigInt(transaction.gasPrice) : null,
  maxFeePerGas: transaction.maxFeePerGas
    ? hexToBigInt(transaction.maxFeePerGas)
    : null,
  maxPriorityFeePerGas: transaction.maxPriorityFeePerGas
    ? hexToBigInt(transaction.maxPriorityFeePerGas)
    : null,
  accessList: transaction.accessList
    ? JSON.stringify(transaction.accessList)
    : null,
});

export const encodeTransactionReceipt = ({
  transactionReceipt,
  chainId,
}: {
  transactionReceipt: SyncTransactionReceipt;
  chainId: number;
}): typeof ponderSyncSchema.transactionReceipts.$inferInsert => ({
  chainId: BigInt(chainId),
  blockNumber: hexToBigInt(transactionReceipt.blockNumber),
  transactionIndex: hexToNumber(transactionReceipt.transactionIndex),
  transactionHash: transactionReceipt.transactionHash,
  blockHash: transactionReceipt.blockHash,
  from: toLowerCase(transactionReceipt.from),
  to: transactionReceipt.to ? toLowerCase(transactionReceipt.to) : null,
  contractAddress: transactionReceipt.contractAddress
    ? toLowerCase(transactionReceipt.contractAddress)
    : null,
  logsBloom: transactionReceipt.logsBloom,
  gasUsed: hexToBigInt(transactionReceipt.gasUsed),
  cumulativeGasUsed: hexToBigInt(transactionReceipt.cumulativeGasUsed),
  effectiveGasPrice: hexToBigInt(transactionReceipt.effectiveGasPrice),
  status: transactionReceipt.status,
  type: transactionReceipt.type as Hex,
});

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
}): typeof ponderSyncSchema.traces.$inferInsert => ({
  chainId: BigInt(chainId),
  blockNumber: hexToBigInt(block.number),
  transactionIndex: hexToNumber(transaction.transactionIndex),
  traceIndex: trace.trace.index,
  from: toLowerCase(trace.trace.from),
  to: trace.trace.to ? toLowerCase(trace.trace.to) : null,
  input: trace.trace.input,
  output: trace.trace.output ?? null,
  value: trace.trace.value ? hexToBigInt(trace.trace.value) : null,
  type: trace.trace.type,
  gas: hexToBigInt(trace.trace.gas),
  gasUsed: hexToBigInt(trace.trace.gasUsed),
  error: trace.trace.error ? trace.trace.error.replace(/\0/g, "") : null,
  revertReason: trace.trace.revertReason
    ? trace.trace.revertReason.replace(/\0/g, "")
    : null,
  subcalls: trace.trace.subcalls,
});
