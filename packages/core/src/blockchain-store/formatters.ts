import {
  type RpcBlock,
  type RpcLog,
  type RpcTransaction,
  hexToNumber,
  transactionType,
} from "viem";

import type {
  InsertableBlock,
  InsertableLog,
  InsertableTransaction,
} from "./schema";

export function formatRpcBlock({ block }: { block: RpcBlock }) {
  const block_: Omit<InsertableBlock, "chainId" | "finalized"> = {
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
  return block_;
}

export function formatRpcTransaction({
  transaction,
}: {
  transaction: RpcTransaction;
}) {
  const transaction_: Omit<InsertableTransaction, "chainId" | "finalized"> = {
    blockHash: transaction.blockHash!,
    blockNumber: BigInt(transaction.blockNumber!),
    from: transaction.from,
    gas: BigInt(transaction.gas),
    gasPrice: transaction.gasPrice ? BigInt(transaction.gasPrice) : undefined,
    hash: transaction.hash,
    input: transaction.input,
    maxFeePerGas: transaction.maxFeePerGas
      ? BigInt(transaction.maxFeePerGas)
      : undefined,
    maxPriorityFeePerGas: transaction.maxPriorityFeePerGas
      ? BigInt(transaction.maxPriorityFeePerGas)
      : undefined,
    nonce: hexToNumber(transaction.nonce),
    r: transaction.r,
    s: transaction.s,
    to: transaction.to ? transaction.to : null,
    transactionIndex: Number(transaction.transactionIndex),
    type: transactionType[transaction.type],
    value: BigInt(transaction.value),
    v: BigInt(transaction.v),
  };
  return transaction_;
}

export function formatRpcLog({ log }: { log: RpcLog }) {
  const log_: Omit<InsertableLog, "chainId" | "finalized"> = {
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
  return log_;
}
