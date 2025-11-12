import type { Common } from "@/internal/common.js";
import type {
  BlockFilter,
  Chain,
  Event,
  EventCallback,
  FactoryId,
  InternalBlock,
  InternalLog,
  InternalTrace,
  InternalTransaction,
  InternalTransactionReceipt,
  LogFilter,
  RawEvent,
  SyncBlock,
  SyncBlockHeader,
  SyncLog,
  SyncTrace,
  SyncTransaction,
  SyncTransactionReceipt,
  TraceFilter,
  TransactionFilter,
  TransferFilter,
} from "@/internal/types.js";
import type {
  Block,
  Trace,
  Transaction,
  TransactionReceipt,
} from "@/types/eth.js";
import {
  EVENT_TYPES,
  MAX_CHECKPOINT,
  ZERO_CHECKPOINT,
  encodeCheckpoint,
} from "@/utils/checkpoint.js";
import { decodeEventLog } from "@/utils/decodeEventLog.js";
import { toLowerCase } from "@/utils/lowercase.js";
import {
  type AbiEvent,
  type AbiFunction,
  type Address,
  type Hash,
  type Hex,
  decodeFunctionData,
  decodeFunctionResult,
  hexToBigInt,
  hexToNumber,
  toEventSelector,
  toFunctionSelector,
} from "viem";
import {
  isAddressMatched,
  isBlockFilterMatched,
  isLogFilterMatched,
  isTraceFilterMatched,
  isTransactionFilterMatched,
  isTransferFilterMatched,
} from "./filter.js";
import { isAddressFactory } from "./filter.js";

/**
 * Create `RawEvent`s from raw data types
 */
export const buildEvents = ({
  eventCallbacks,
  blocks,
  logs,
  transactions,
  transactionReceipts,
  traces,
  childAddresses,
  chainId,
}: {
  eventCallbacks: EventCallback[];
  blocks: InternalBlock[];
  logs: InternalLog[];
  transactions: InternalTransaction[];
  transactionReceipts: InternalTransactionReceipt[];
  traces: InternalTrace[];
  childAddresses: Map<FactoryId, Map<Address, number>>;
  chainId: number;
}) => {
  const events: RawEvent[] = [];

  const blockEventCallbackIndexes: number[] = [];
  const transactionEventCallbackIndexes: number[] = [];
  const logEventCallbackIndexes: number[] = [];
  const traceEventCallbackIndexes: number[] = [];
  const transferEventCallbackIndexes: number[] = [];

  for (let i = 0; i < eventCallbacks.length; i++) {
    const eventCallback = eventCallbacks[i]!;
    if (chainId !== eventCallback.filter.chainId) continue;
    if (eventCallback.filter.type === "block") {
      blockEventCallbackIndexes.push(i);
    } else if (eventCallback.filter.type === "transaction") {
      transactionEventCallbackIndexes.push(i);
    } else if (eventCallback.filter.type === "log") {
      logEventCallbackIndexes.push(i);
    } else if (eventCallback.filter.type === "trace") {
      traceEventCallbackIndexes.push(i);
    } else if (eventCallback.filter.type === "transfer") {
      transferEventCallbackIndexes.push(i);
    }
  }

  let blocksIndex = 0;
  let transactionsIndex = 0;
  let transactionReceiptsIndex = 0;

  for (const block of blocks) {
    for (const blockEventCallbackIndex of blockEventCallbackIndexes) {
      const filter = eventCallbacks[blockEventCallbackIndex]!
        .filter as BlockFilter;
      if (isBlockFilterMatched({ filter, block })) {
        events.push({
          chainId: filter.chainId,
          eventCallbackIndex: blockEventCallbackIndex,
          checkpoint: encodeCheckpoint({
            blockTimestamp: block.timestamp,
            chainId: filter.chainId,
            blockNumber: block.number,
            transactionIndex: MAX_CHECKPOINT.transactionIndex,
            eventType: EVENT_TYPES.blocks,
            eventIndex: ZERO_CHECKPOINT.eventIndex,
          }),
          block,
          log: undefined,
          trace: undefined,
          transaction: undefined,
          transactionReceipt: undefined,
        });
      }
    }
  }

  for (const transaction of transactions) {
    const blockNumber = transaction.blockNumber;
    const transactionIndex = transaction.transactionIndex;

    while (
      blocksIndex < blocks.length &&
      Number(blocks[blocksIndex]!.number) < blockNumber
    ) {
      blocksIndex++;
    }

    const block = blocks[blocksIndex]!;

    if (block === undefined) {
      throw new Error(
        `Failed to build events from block data. Missing block ${blockNumber} for chain ID ${chainId}`,
      );
    }

    while (
      transactionReceiptsIndex < transactionReceipts.length &&
      (transactionReceipts[transactionReceiptsIndex]!.blockNumber <
        blockNumber ||
        (transactionReceipts[transactionReceiptsIndex]!.blockNumber ===
          blockNumber &&
          transactionReceipts[transactionReceiptsIndex]!.transactionIndex <
            transactionIndex))
    ) {
      transactionReceiptsIndex++;
    }

    const transactionReceipt = transactionReceipts[transactionReceiptsIndex]!;

    for (const transactionEventCallbackIndex of transactionEventCallbackIndexes) {
      const filter = eventCallbacks[transactionEventCallbackIndex]!
        .filter as TransactionFilter;
      if (
        isTransactionFilterMatched({ filter, transaction }) &&
        (isAddressFactory(filter.fromAddress)
          ? isAddressMatched({
              address: transaction.from,
              blockNumber,
              childAddresses: childAddresses.get(filter.fromAddress.id)!,
            })
          : true) &&
        (isAddressFactory(filter.toAddress)
          ? isAddressMatched({
              address: transaction.to ?? undefined,
              blockNumber,
              childAddresses: childAddresses.get(filter.toAddress.id)!,
            })
          : true) &&
        (filter.includeReverted
          ? true
          : transactionReceipt.status === "success")
      ) {
        if (filter.hasTransactionReceipt && transactionReceipt === undefined) {
          throw new Error(
            `Failed to build events from block data. Missing transaction receipt for block ${blockNumber} and transaction index ${transactionIndex} for chain ID ${chainId}`,
          );
        }

        events.push({
          chainId: filter.chainId,
          eventCallbackIndex: transactionEventCallbackIndex,
          checkpoint: encodeCheckpoint({
            blockTimestamp: block.timestamp,
            chainId: filter.chainId,
            blockNumber,
            transactionIndex,
            eventType: EVENT_TYPES.transactions,
            eventIndex: 0n,
          }),
          log: undefined,
          trace: undefined,
          block,
          transaction,
          transactionReceipt,
        });
      }
    }
  }

  blocksIndex = 0;
  transactionReceiptsIndex = 0;

  for (const trace of traces) {
    const blockNumber = trace.blockNumber;
    const transactionIndex = trace.transactionIndex;
    const traceIndex = trace.traceIndex;

    while (
      blocksIndex < blocks.length &&
      Number(blocks[blocksIndex]!.number) < blockNumber
    ) {
      blocksIndex++;
    }

    const block = blocks[blocksIndex]!;

    if (block === undefined) {
      throw new Error(
        `Failed to build events from block data. Missing block ${blockNumber} for chain ID ${chainId}`,
      );
    }

    while (
      transactionsIndex < transactions.length &&
      (transactions[transactionsIndex]!.blockNumber < blockNumber ||
        (transactions[transactionsIndex]!.blockNumber === blockNumber &&
          transactions[transactionsIndex]!.transactionIndex < transactionIndex))
    ) {
      transactionsIndex++;
    }

    let transaction: InternalTransaction | undefined;
    if (
      transactionsIndex < transactions.length &&
      transactions[transactionsIndex]!.blockNumber === blockNumber &&
      transactions[transactionsIndex]!.transactionIndex === transactionIndex
    ) {
      transaction = transactions[transactionsIndex]!;
    }

    if (transaction === undefined) {
      throw new Error(
        `Failed to build events from block data. Missing transaction for block ${blockNumber} and transaction index ${transactionIndex} for chain ID ${chainId}`,
      );
    }

    while (
      transactionReceiptsIndex < transactionReceipts.length &&
      (transactionReceipts[transactionReceiptsIndex]!.blockNumber <
        blockNumber ||
        (transactionReceipts[transactionReceiptsIndex]!.blockNumber ===
          blockNumber &&
          transactionReceipts[transactionReceiptsIndex]!.transactionIndex <
            transactionIndex))
    ) {
      transactionReceiptsIndex++;
    }

    let transactionReceipt: InternalTransactionReceipt | undefined;
    if (
      transactionReceiptsIndex < transactionReceipts.length &&
      transactionReceipts[transactionReceiptsIndex]!.blockNumber ===
        blockNumber &&
      transactionReceipts[transactionReceiptsIndex]!.transactionIndex ===
        transactionIndex
    ) {
      transactionReceipt = transactionReceipts[transactionReceiptsIndex]!;
    }

    for (const traceEventCallbackIndex of traceEventCallbackIndexes) {
      const filter = eventCallbacks[traceEventCallbackIndex]!
        .filter as TraceFilter;

      if (
        isTraceFilterMatched({ filter, trace, block }) &&
        (isAddressFactory(filter.fromAddress)
          ? isAddressMatched({
              address: trace.from,
              blockNumber,
              childAddresses: childAddresses.get(filter.fromAddress.id)!,
            })
          : true) &&
        (isAddressFactory(filter.toAddress)
          ? isAddressMatched({
              address: trace.to ?? undefined,
              blockNumber,
              childAddresses: childAddresses.get(filter.toAddress.id)!,
            })
          : true) &&
        (filter.callType === undefined
          ? true
          : filter.callType === trace.type) &&
        (filter.includeReverted ? true : trace.error === undefined)
      ) {
        if (filter.hasTransactionReceipt && transactionReceipt === undefined) {
          throw new Error(
            `Failed to build events from block data. Missing transaction receipt for block ${blockNumber} and transaction index ${transactionIndex} for chain ID ${chainId}`,
          );
        }

        events.push({
          chainId: filter.chainId,
          eventCallbackIndex: traceEventCallbackIndex,
          checkpoint: encodeCheckpoint({
            blockTimestamp: block.timestamp,
            chainId: filter.chainId,
            blockNumber,
            transactionIndex,
            eventType: EVENT_TYPES.traces,
            eventIndex: traceIndex,
          }),
          log: undefined,
          trace,
          block,
          transaction,
          transactionReceipt: filter.hasTransactionReceipt
            ? transactionReceipt
            : undefined,
        });
      }
    }

    for (const transferEventCallbackIndex of transferEventCallbackIndexes) {
      const filter = eventCallbacks[transferEventCallbackIndex]!
        .filter as TransferFilter;

      if (
        isTransferFilterMatched({ filter, trace, block }) &&
        (isAddressFactory(filter.fromAddress)
          ? isAddressMatched({
              address: trace.from,
              blockNumber,
              childAddresses: childAddresses.get(filter.fromAddress.id)!,
            })
          : true) &&
        (isAddressFactory(filter.toAddress)
          ? isAddressMatched({
              address: trace.to ?? undefined,
              blockNumber,
              childAddresses: childAddresses.get(filter.toAddress.id)!,
            })
          : true) &&
        (filter.includeReverted ? true : trace.error === undefined)
      ) {
        if (filter.hasTransactionReceipt && transactionReceipt === undefined) {
          throw new Error(
            `Failed to build events from block data. Missing transaction receipt for block ${blockNumber} and transaction index ${transactionIndex} for chain ID ${chainId}`,
          );
        }

        events.push({
          chainId: filter.chainId,
          eventCallbackIndex: transferEventCallbackIndex,
          checkpoint: encodeCheckpoint({
            blockTimestamp: block.timestamp,
            chainId: filter.chainId,
            blockNumber,
            transactionIndex,
            eventType: EVENT_TYPES.traces,
            eventIndex: trace.traceIndex,
          }),
          log: undefined,
          trace,
          block,
          transaction,
          transactionReceipt: filter.hasTransactionReceipt
            ? transactionReceipt
            : undefined,
        });
      }
    }
  }

  blocksIndex = 0;
  transactionsIndex = 0;
  transactionReceiptsIndex = 0;

  for (const log of logs) {
    const blockNumber = log.blockNumber;
    const transactionIndex = log.transactionIndex;

    while (
      blocksIndex < blocks.length &&
      Number(blocks[blocksIndex]!.number) < blockNumber
    ) {
      blocksIndex++;
    }

    const block = blocks[blocksIndex]!;

    if (block === undefined) {
      throw new Error(
        `Failed to build events from block data. Missing block ${blockNumber} for chain ID ${chainId}`,
      );
    }

    while (
      transactionsIndex < transactions.length &&
      (transactions[transactionsIndex]!.blockNumber < blockNumber ||
        (transactions[transactionsIndex]!.blockNumber === blockNumber &&
          transactions[transactionsIndex]!.transactionIndex < transactionIndex))
    ) {
      transactionsIndex++;
    }

    let transaction: InternalTransaction | undefined;
    if (
      transactionsIndex < transactions.length &&
      transactions[transactionsIndex]!.blockNumber === blockNumber &&
      transactions[transactionsIndex]!.transactionIndex === transactionIndex
    ) {
      transaction = transactions[transactionsIndex]!;
    }

    // Note: transaction can be undefined, this is expected behavior on
    // chains like zkSync.

    while (
      transactionReceiptsIndex < transactionReceipts.length &&
      (transactionReceipts[transactionReceiptsIndex]!.blockNumber <
        blockNumber ||
        (transactionReceipts[transactionReceiptsIndex]!.blockNumber ===
          blockNumber &&
          transactionReceipts[transactionReceiptsIndex]!.transactionIndex <
            transactionIndex))
    ) {
      transactionReceiptsIndex++;
    }

    let transactionReceipt: InternalTransactionReceipt | undefined;
    if (
      transactionReceiptsIndex < transactionReceipts.length &&
      transactionReceipts[transactionReceiptsIndex]!.blockNumber ===
        blockNumber &&
      transactionReceipts[transactionReceiptsIndex]!.transactionIndex ===
        transactionIndex
    ) {
      transactionReceipt = transactionReceipts[transactionReceiptsIndex]!;
    }

    for (const logEventCallbackIndex of logEventCallbackIndexes) {
      const filter = eventCallbacks[logEventCallbackIndex]!.filter as LogFilter;
      if (
        isLogFilterMatched({ filter, log }) &&
        (isAddressFactory(filter.address)
          ? isAddressMatched({
              address: log.address,
              blockNumber,
              childAddresses: childAddresses.get(filter.address.id)!,
            })
          : true)
      ) {
        if (filter.hasTransactionReceipt && transactionReceipt === undefined) {
          throw new Error(
            `Failed to build events from block data. Missing transaction receipt for block ${blockNumber} and transaction index ${transactionIndex} for chain ID ${chainId}`,
          );
        }

        events.push({
          chainId: filter.chainId,
          eventCallbackIndex: logEventCallbackIndex,
          checkpoint: encodeCheckpoint({
            blockTimestamp: block.timestamp,
            chainId: filter.chainId,
            blockNumber,
            transactionIndex: log.transactionIndex,
            eventType: EVENT_TYPES.logs,
            eventIndex: log.logIndex,
          }),
          log,
          block,
          transaction,
          transactionReceipt: filter.hasTransactionReceipt
            ? transactionReceipt
            : undefined,
          trace: undefined,
        });
      }
    }
  }

  return events.sort((a, b) => (a.checkpoint < b.checkpoint ? -1 : 1));
};

export const splitEvents = (
  events: Event[],
): { events: Event[]; chainId: number; checkpoint: string }[] => {
  let hash: Hash | undefined;
  const result: { events: Event[]; chainId: number; checkpoint: string }[] = [];

  for (const event of events) {
    if (hash === undefined || hash !== event.event.block.hash) {
      result.push({
        events: [],
        chainId: event.chain.id,
        checkpoint: encodeCheckpoint({
          ...MAX_CHECKPOINT,
          blockTimestamp: event.event.block.timestamp,
          chainId: BigInt(event.chain.id),
          blockNumber: event.event.block.number,
        }),
      });
      hash = event.event.block.hash;
    }

    result[result.length - 1]!.events.push(event);
  }

  return result;
};

export const decodeEvents = (
  common: Common,
  chain: Chain,
  eventCallbacks: EventCallback[],
  rawEvents: RawEvent[],
): Event[] => {
  const events: Event[] = [];

  const logDecodeFailureSelectors = new Set<Hex>();
  let logDecodeFailureCount = 0;
  let logDecodeSuccessCount = 0;

  const traceDecodeFailureSelectors = new Set<Hex>();
  let traceDecodeFailureCount = 0;
  let traceDecodeSuccessCount = 0;

  for (const event of rawEvents) {
    const eventCallback = eventCallbacks[event.eventCallbackIndex]!;

    if (
      eventCallback.type === "contract" &&
      eventCallback.filter.type === "log"
    ) {
      let args: any;
      try {
        args = decodeEventLog({
          abiItem: eventCallback.abiItem as AbiEvent,
          data: event.log!.data,
          topics: event.log!.topics,
        });
        logDecodeSuccessCount++;
      } catch (err) {
        logDecodeFailureCount++;
        const selector = toEventSelector(eventCallback.abiItem as AbiEvent);
        if (!logDecodeFailureSelectors.has(selector)) {
          logDecodeFailureSelectors.add(selector);
          common.logger.debug({
            msg: "Failed to decode matched event log using provided ABI item",
            chain: eventCallback.chain.name,
            chain_id: eventCallback.chain.id,
            event: eventCallback.name,
            block_number: event?.block?.number ?? "unknown",
            log_index: event.log?.logIndex,
            data: event.log?.data,
            topics: JSON.stringify(event.log?.topics),
          });
        }
        continue;
      }

      events.push({
        type: "log",
        checkpoint: event.checkpoint,
        chain,
        eventCallback,

        event: {
          id: event.checkpoint,
          args,
          log: event.log!,
          block: event.block as Block,
          transaction: event.transaction! as Transaction,
          transactionReceipt: event.transactionReceipt as TransactionReceipt,
        },
      });
    } else if (
      eventCallback.type === "contract" &&
      eventCallback.filter.type === "trace"
    ) {
      let decodedData: { args: readonly unknown[]; functionName: string };
      let decodedResult: readonly unknown[];
      try {
        decodedData = decodeFunctionData({
          abi: [eventCallback.abiItem as AbiFunction],
          data: event.trace!.input,
        });

        decodedResult = decodeFunctionResult({
          abi: [eventCallback.abiItem as AbiFunction],
          data: event.trace!.output ?? "0x",
          functionName: decodedData.functionName,
        });
        traceDecodeSuccessCount++;
      } catch (err) {
        traceDecodeFailureCount++;
        const selector = toFunctionSelector(
          eventCallback.abiItem as AbiFunction,
        );
        if (!traceDecodeFailureSelectors.has(selector)) {
          traceDecodeFailureSelectors.add(selector);
          common.logger.debug({
            msg: "Failed to decode matched call trace using provided ABI item",
            chain: eventCallback.chain.name,
            chain_id: eventCallback.chain.id,
            function: eventCallback.name,
            block_number: event?.block?.number ?? "unknown",
            transaction_index: event.transaction?.transactionIndex,
            trace_index: event.trace?.traceIndex,
            input: event.trace?.input,
            output: event.trace?.output,
          });
        }
        continue;
      }

      events.push({
        type: "trace",
        checkpoint: event.checkpoint,
        chain,
        eventCallback,

        event: {
          id: event.checkpoint,
          args: decodedData.args,
          result: decodedResult,
          trace: event.trace! as Trace,
          block: event.block as Block,
          transaction: event.transaction! as Transaction,
          transactionReceipt: event.transactionReceipt as TransactionReceipt,
        },
      });
    } else if (
      eventCallback.type === "account" &&
      eventCallback.filter.type === "transaction"
    ) {
      events.push({
        type: "transaction",
        checkpoint: event.checkpoint,
        chain,
        eventCallback,

        event: {
          id: event.checkpoint,
          block: event.block as Block,
          transaction: event.transaction! as Transaction,
          transactionReceipt: event.transactionReceipt as TransactionReceipt,
        },
      });
    } else if (
      eventCallback.type === "account" &&
      eventCallback.filter.type === "transfer"
    ) {
      events.push({
        type: "transfer",
        checkpoint: event.checkpoint,
        chain,
        eventCallback,

        event: {
          id: event.checkpoint,
          transfer: {
            from: event.trace!.from,
            to: event.trace!.to!,
            value: event.trace!.value!,
          },
          block: event.block as Block,
          transaction: event.transaction! as Transaction,
          transactionReceipt: event.transactionReceipt as TransactionReceipt,
          trace: event.trace! as Trace,
        },
      });
    } else if (eventCallback.type === "block") {
      events.push({
        type: "block",
        checkpoint: event.checkpoint,
        chain,
        eventCallback,
        event: {
          id: event.checkpoint,
          block: event.block as Block,
        },
      });
    }
  }

  if (logDecodeFailureCount > 0) {
    common.logger.debug({
      msg: "Event batch contained logs that could not be decoded",
      failure_count: logDecodeFailureCount,
      success_count: logDecodeSuccessCount,
    });
  }

  if (traceDecodeFailureCount > 0) {
    common.logger.debug({
      msg: "Event batch contained traces that could not be decoded",
      failure_count: traceDecodeFailureCount,
      success_count: traceDecodeSuccessCount,
    });
  }

  return events;
};

export const syncBlockToInternal = ({
  block,
}: { block: SyncBlock | SyncBlockHeader }): InternalBlock => ({
  baseFeePerGas: block.baseFeePerGas ? hexToBigInt(block.baseFeePerGas) : null,
  difficulty: hexToBigInt(block.difficulty),
  extraData: block.extraData,
  gasLimit: hexToBigInt(block.gasLimit),
  gasUsed: hexToBigInt(block.gasUsed),
  hash: block.hash,
  logsBloom: block.logsBloom,
  miner: toLowerCase(block.miner),
  mixHash: block.mixHash,
  nonce: block.nonce,
  number: hexToBigInt(block.number),
  parentHash: block.parentHash,
  receiptsRoot: block.receiptsRoot,
  sha3Uncles: block.sha3Uncles,
  size: hexToBigInt(block.size),
  stateRoot: block.stateRoot,
  timestamp: hexToBigInt(block.timestamp),
  totalDifficulty: block.totalDifficulty
    ? hexToBigInt(block.totalDifficulty)
    : null,
  transactionsRoot: block.transactionsRoot,
});

export const syncLogToInternal = ({ log }: { log: SyncLog }): InternalLog => ({
  blockNumber: hexToNumber(log.blockNumber),
  logIndex: hexToNumber(log.logIndex),
  transactionIndex: hexToNumber(log.transactionIndex),
  address: toLowerCase(log.address!),
  data: log.data,
  removed: false,
  topics: log.topics,
});

export const syncTransactionToInternal = ({
  transaction,
}: {
  transaction: SyncTransaction;
}): InternalTransaction => ({
  blockNumber: hexToNumber(transaction.blockNumber),
  transactionIndex: hexToNumber(transaction.transactionIndex),
  from: toLowerCase(transaction.from),
  gas: hexToBigInt(transaction.gas),
  hash: transaction.hash,
  input: transaction.input,
  nonce: hexToNumber(transaction.nonce),
  r: transaction.r,
  s: transaction.s,
  to: transaction.to ? toLowerCase(transaction.to) : transaction.to,
  value: hexToBigInt(transaction.value),
  v: transaction.v ? hexToBigInt(transaction.v) : null,
  ...(transaction.type === "0x0"
    ? {
        type: "legacy",
        gasPrice: hexToBigInt(transaction.gasPrice),
      }
    : transaction.type === "0x1"
      ? {
          type: "eip2930",
          gasPrice: hexToBigInt(transaction.gasPrice),
          accessList: transaction.accessList,
        }
      : transaction.type === "0x2"
        ? {
            type: "eip1559",
            maxFeePerGas: hexToBigInt(transaction.maxFeePerGas),
            maxPriorityFeePerGas: hexToBigInt(transaction.maxPriorityFeePerGas),
          }
        : // @ts-ignore
          transaction.type === "0x7e"
          ? {
              type: "deposit",
              // @ts-ignore
              maxFeePerGas: transaction.maxFeePerGas
                ? // @ts-ignore
                  hexToBigInt(transaction.maxFeePerGas)
                : undefined,
              // @ts-ignore
              maxPriorityFeePerGas: transaction.maxPriorityFeePerGas
                ? // @ts-ignore
                  hexToBigInt(transaction.maxPriorityFeePerGas)
                : undefined,
            }
          : {
              // @ts-ignore
              type: transaction.type,
            }),
});

export const syncTransactionReceiptToInternal = ({
  transactionReceipt,
}: {
  transactionReceipt: SyncTransactionReceipt;
}): InternalTransactionReceipt => ({
  blockNumber: hexToNumber(transactionReceipt.blockNumber),
  transactionIndex: hexToNumber(transactionReceipt.transactionIndex),
  contractAddress: transactionReceipt.contractAddress
    ? toLowerCase(transactionReceipt.contractAddress)
    : null,
  cumulativeGasUsed: hexToBigInt(transactionReceipt.cumulativeGasUsed),
  effectiveGasPrice: hexToBigInt(transactionReceipt.effectiveGasPrice),
  from: toLowerCase(transactionReceipt.from),
  gasUsed: hexToBigInt(transactionReceipt.gasUsed),
  logsBloom: transactionReceipt.logsBloom,
  status:
    transactionReceipt.status === "0x1"
      ? "success"
      : transactionReceipt.status === "0x0"
        ? "reverted"
        : (transactionReceipt.status as InternalTransactionReceipt["status"]),
  to: transactionReceipt.to ? toLowerCase(transactionReceipt.to) : null,
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

export const syncTraceToInternal = ({
  trace,
  block,
  transaction,
}: {
  trace: SyncTrace;
  block: Pick<SyncBlock, "number">;
  transaction: Pick<SyncTransaction, "transactionIndex">;
}): InternalTrace => ({
  blockNumber: hexToNumber(block.number),
  traceIndex: trace.trace.index,
  transactionIndex: hexToNumber(transaction.transactionIndex),
  type: trace.trace.type,
  from: toLowerCase(trace.trace.from),
  to: trace.trace.to ? toLowerCase(trace.trace.to) : null,
  gas: hexToBigInt(trace.trace.gas),
  gasUsed: hexToBigInt(trace.trace.gasUsed),
  input: trace.trace.input,
  output: trace.trace.output,
  error: trace.trace.error,
  revertReason: trace.trace.revertReason,
  value: trace.trace.value ? hexToBigInt(trace.trace.value) : null,
  subcalls: trace.trace.subcalls,
});
