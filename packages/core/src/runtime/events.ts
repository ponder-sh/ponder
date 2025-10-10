import type { Common } from "@/internal/common.js";
import type {
  BlockFilter,
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
  decodeFunctionData,
  decodeFunctionResult,
  hexToBigInt,
  hexToNumber,
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
}: {
  eventCallbacks: EventCallback[];
  blocks: InternalBlock[];
  logs: InternalLog[];
  transactions: InternalTransaction[];
  transactionReceipts: InternalTransactionReceipt[];
  traces: InternalTrace[];
  childAddresses: Map<FactoryId, Map<Address, number>>;
}) => {
  const events: RawEvent[] = [];

  const blockEventCallbacks: EventCallback[] = [];
  const transactionEventCallbacks: EventCallback[] = [];
  const logEventCallbacks: EventCallback[] = [];
  const traceEventCallbacks: EventCallback[] = [];
  const transferEventCallbacks: EventCallback[] = [];

  for (const eventCallback of eventCallbacks) {
    if (eventCallback.filter.type === "block") {
      blockEventCallbacks.push(eventCallback);
    } else if (eventCallback.filter.type === "transaction") {
      transactionEventCallbacks.push(eventCallback);
    } else if (eventCallback.filter.type === "log") {
      logEventCallbacks.push(eventCallback);
    } else if (eventCallback.filter.type === "trace") {
      traceEventCallbacks.push(eventCallback);
    } else if (eventCallback.filter.type === "transfer") {
      transferEventCallbacks.push(eventCallback);
    }
  }

  let blocksIndex = 0;
  let transactionsIndex = 0;
  let transactionReceiptsIndex = 0;

  for (const block of blocks) {
    for (const eventCallback of blockEventCallbacks) {
      const filter = eventCallback.filter as BlockFilter;
      if (isBlockFilterMatched({ filter, block })) {
        events.push({
          chain: eventCallback.chain,
          eventCallback,
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
        `Failed to build events from block data. Missing block ${blockNumber}`,
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

    for (const eventCallback of transactionEventCallbacks) {
      const filter = eventCallback.filter as TransactionFilter;
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
            `Failed to build events from block data. Missing transaction receipt for block ${blockNumber} and transaction index ${transactionIndex} for chain ID ${eventCallback.chain.id}`,
          );
        }

        events.push({
          chain: eventCallback.chain,
          eventCallback,
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
        `Failed to build events from block data. Missing block ${blockNumber}`,
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
        `Failed to build events from block data. Missing transaction for block ${blockNumber} and transaction index ${transactionIndex}`,
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

    for (const eventCallback of traceEventCallbacks) {
      const filter = eventCallback.filter as TraceFilter;

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
            `Failed to build events from block data. Missing transaction receipt for block ${blockNumber} and transaction index ${transactionIndex}`,
          );
        }

        events.push({
          chain: eventCallback.chain,
          eventCallback,
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

    for (const eventCallback of transferEventCallbacks) {
      const filter = eventCallback.filter as TransferFilter;

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
            `Failed to build events from block data. Missing transaction receipt for block ${blockNumber} and transaction index ${transactionIndex}`,
          );
        }

        events.push({
          chain: eventCallback.chain,
          eventCallback,
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
        `Failed to build events from block data. Missing block ${blockNumber}`,
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

    for (const eventCallback of logEventCallbacks) {
      const filter = eventCallback.filter as LogFilter;
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
            `Failed to build events from block data. Missing transaction receipt for block ${blockNumber} and transaction index ${transactionIndex}`,
          );
        }

        events.push({
          chain: eventCallback.chain,
          eventCallback,
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
  rawEvents: RawEvent[],
): Event[] => {
  const events: Event[] = [];

  for (const event of rawEvents) {
    if (
      event.eventCallback.type === "contract" &&
      event.eventCallback.filter.type === "log"
    ) {
      try {
        const args = decodeEventLog({
          abiItem: event.eventCallback.abiItem as AbiEvent,
          data: event.log!.data,
          topics: event.log!.topics,
        });

        events.push({
          type: "log",
          checkpoint: event.checkpoint,
          chain: event.chain,
          eventCallback: event.eventCallback,

          event: {
            id: event.checkpoint,
            args,
            log: event.log!,
            block: event.block as Block,
            transaction: event.transaction! as Transaction,
            transactionReceipt: event.transactionReceipt as TransactionReceipt,
          },
        });
      } catch (err) {
        const blockNumber = event?.block?.number ?? "unknown";
        if (event.eventCallback.filter.address === undefined) {
          common.logger.debug({
            msg: "Unable to decode log, skipping it",
            block_number: blockNumber,
            log_index: event.log?.logIndex,
            data: event.log?.data,
            topics: JSON.stringify(event.log?.topics),
          });
        } else {
          common.logger.warn({
            msg: "Unable to decode log, skipping it",
            block_number: blockNumber,
            log_index: event.log?.logIndex,
            data: event.log?.data,
            topics: JSON.stringify(event.log?.topics),
          });
        }
      }
    } else if (
      event.eventCallback.type === "contract" &&
      event.eventCallback.filter.type === "trace"
    ) {
      try {
        const { args, functionName } = decodeFunctionData({
          abi: [event.eventCallback.abiItem as AbiFunction],
          data: event.trace!.input,
        });

        const result = decodeFunctionResult({
          abi: [event.eventCallback.abiItem as AbiFunction],
          data: event.trace!.output ?? "0x",
          functionName,
        });

        events.push({
          type: "trace",
          checkpoint: event.checkpoint,
          chain: event.chain,
          eventCallback: event.eventCallback,

          event: {
            id: event.checkpoint,
            args,
            result,
            trace: event.trace! as Trace,
            block: event.block as Block,
            transaction: event.transaction! as Transaction,
            transactionReceipt: event.transactionReceipt as TransactionReceipt,
          },
        });
      } catch (err) {
        const blockNumber = event?.block?.number ?? "unknown";
        if (event.eventCallback.filter.toAddress === undefined) {
          common.logger.debug({
            msg: "Unable to decode trace, skipping it",
            block_number: blockNumber,
            transaction_index: event.transaction?.transactionIndex,
            trace_index: event.trace?.traceIndex,
            input: event.trace?.input,
            output: event.trace?.output,
          });
        } else {
          common.logger.warn({
            msg: "Unable to decode trace, skipping it",
            block_number: blockNumber,
            transaction_index: event.transaction?.transactionIndex,
            trace_index: event.trace?.traceIndex,
            input: event.trace?.input,
            output: event.trace?.output,
          });
        }
      }
    } else if (
      event.eventCallback.type === "account" &&
      event.eventCallback.filter.type === "transaction"
    ) {
      events.push({
        type: "transaction",
        checkpoint: event.checkpoint,
        chain: event.chain,
        eventCallback: event.eventCallback,

        event: {
          id: event.checkpoint,
          block: event.block as Block,
          transaction: event.transaction! as Transaction,
          transactionReceipt: event.transactionReceipt as TransactionReceipt,
        },
      });
    } else if (
      event.eventCallback.type === "account" &&
      event.eventCallback.filter.type === "transfer"
    ) {
      events.push({
        type: "transfer",
        chain: event.chain,
        eventCallback: event.eventCallback,
        checkpoint: event.checkpoint,

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
    } else if (event.eventCallback.type === "block") {
      events.push({
        type: "block",
        checkpoint: event.checkpoint,
        chain: event.chain,
        eventCallback: event.eventCallback,
        event: {
          id: event.checkpoint,
          block: event.block as Block,
        },
      });
    }
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
