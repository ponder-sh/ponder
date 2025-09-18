import type { Common } from "@/internal/common.js";
import type {
  Event,
  FactoryId,
  InternalBlock,
  InternalLog,
  InternalTrace,
  InternalTransaction,
  InternalTransactionReceipt,
  RawEvent,
  Source,
  SyncBlock,
  SyncBlockHeader,
  SyncLog,
  SyncTrace,
  SyncTransaction,
  SyncTransactionReceipt,
} from "@/internal/types.js";
import {
  EVENT_TYPES,
  MAX_CHECKPOINT,
  ZERO_CHECKPOINT,
  encodeCheckpoint,
} from "@/utils/checkpoint.js";
import { decodeEventLog } from "@/utils/decodeEventLog.js";
import { toLowerCase } from "@/utils/lowercase.js";
import { never } from "@/utils/never.js";
import {
  type Address,
  type Hash,
  type Hex,
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
  shouldGetTransactionReceipt,
} from "./filter.js";
import { isAddressFactory } from "./filter.js";

/**
 * Create `RawEvent`s from raw data types.
 *
 * @dev `blocks`, `transactions`, `transactionReceipts`, `logs`, `traces` must be ordered by onchain execution.
 */
export const buildEvents = ({
  sources,
  blocks,
  logs,
  transactions,
  transactionReceipts,
  traces,
  childAddresses,
  chainId,
}: {
  sources: Source[];
  blocks: InternalBlock[];
  logs: InternalLog[];
  transactions: InternalTransaction[];
  transactionReceipts: InternalTransactionReceipt[];
  traces: InternalTrace[];
  childAddresses: Map<FactoryId, Map<Address, number>>;
  chainId: number;
}) => {
  const events: RawEvent[] = [];

  const blockSourceIndexes: number[] = [];
  const transactionSourceIndexes: number[] = [];
  const logSourceIndexes: number[] = [];
  const traceSourceIndexes: number[] = [];
  const transferSourceIndexes: number[] = [];

  for (let i = 0; i < sources.length; i++) {
    const source = sources[i]!;
    if (source.filter.type === "block") {
      blockSourceIndexes.push(i);
    } else if (source.filter.type === "transaction") {
      transactionSourceIndexes.push(i);
    } else if (source.filter.type === "log") {
      logSourceIndexes.push(i);
    } else if (source.filter.type === "trace") {
      traceSourceIndexes.push(i);
    } else if (source.filter.type === "transfer") {
      transferSourceIndexes.push(i);
    }
  }

  let transactionsIndex = 0;
  let transactionReceiptsIndex = 0;
  let tracesIndex = 0;
  let logsIndex = 0;

  for (const block of blocks) {
    const blockNumber = Number(block.number);
    const blockTimestamp = Number(block.timestamp);

    while (
      transactionsIndex < transactions.length &&
      transactions[transactionsIndex]!.blockNumber < blockNumber
    ) {
      transactionsIndex++;
    }

    while (
      transactionsIndex < transactions.length &&
      transactions[transactionsIndex]!.blockNumber === blockNumber
    ) {
      const transaction = transactions[transactionsIndex]!;

      while (
        transactionReceiptsIndex < transactionReceipts.length &&
        (transactionReceipts[transactionReceiptsIndex]!.blockNumber <
          blockNumber ||
          (transactionReceipts[transactionReceiptsIndex]!.blockNumber ===
            blockNumber &&
            transactionReceipts[transactionReceiptsIndex]!.transactionIndex <
              transaction.transactionIndex))
      ) {
        transactionReceiptsIndex++;
      }

      let transactionReceipt: InternalTransactionReceipt | undefined;
      if (
        transactionReceiptsIndex < transactionReceipts.length &&
        transactionReceipts[transactionReceiptsIndex]!.blockNumber ===
          blockNumber &&
        transactionReceipts[transactionReceiptsIndex]!.transactionIndex ===
          transaction.transactionIndex
      ) {
        transactionReceipt = transactionReceipts[transactionReceiptsIndex]!;
        transactionReceiptsIndex++;
      }

      for (const i of transactionSourceIndexes) {
        const source = sources[i]!;
        const filter = source.filter;
        if (chainId !== filter.chainId) continue;
        if (filter.type !== "transaction") continue;

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
            : transactionReceipt!.status === "success")
        ) {
          events.push({
            chainId,
            sourceIndex: i,
            checkpoint: encodeCheckpoint({
              blockTimestamp,
              chainId,
              blockNumber,
              transactionIndex: transaction.transactionIndex,
              eventType: EVENT_TYPES.transactions,
              eventIndex: 0,
            }),
            block,
            transaction,
            transactionReceipt: transactionReceipt!,
          });
        }
      }

      while (
        logsIndex < logs.length &&
        (logs[logsIndex]!.blockNumber < blockNumber ||
          (logs[logsIndex]!.blockNumber === blockNumber &&
            logs[logsIndex]!.transactionIndex < transaction.transactionIndex))
      ) {
        // TODO(kyle) zkSync logs may not have a corresponding transaction.
        logsIndex++;
      }

      while (
        logsIndex < logs.length &&
        logs[logsIndex]!.blockNumber === blockNumber &&
        logs[logsIndex]!.transactionIndex === transaction.transactionIndex
      ) {
        const log = logs[logsIndex]!;

        for (const i of logSourceIndexes) {
          const source = sources[i]!;
          const filter = source.filter;
          if (chainId !== filter.chainId) continue;
          if (filter.type !== "log") continue;

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
            events.push({
              chainId,
              sourceIndex: i,
              checkpoint: encodeCheckpoint({
                blockTimestamp,
                chainId,
                blockNumber,
                transactionIndex: log.transactionIndex,
                eventType: EVENT_TYPES.logs,
                eventIndex: log.logIndex,
              }),
              log,
              block,
              transaction,
              transactionReceipt: shouldGetTransactionReceipt(filter)
                ? transactionReceipt
                : undefined,
            });
          }
        }

        logsIndex++;
      }

      while (
        tracesIndex < traces.length &&
        (traces[tracesIndex]!.blockNumber < blockNumber ||
          (traces[tracesIndex]!.blockNumber === blockNumber &&
            traces[tracesIndex]!.transactionIndex <
              transaction.transactionIndex))
      ) {
        tracesIndex++;
      }

      while (
        tracesIndex < traces.length &&
        traces[tracesIndex]!.blockNumber === blockNumber &&
        traces[tracesIndex]!.transactionIndex === transaction.transactionIndex
      ) {
        const trace = traces[tracesIndex]!;

        for (const i of traceSourceIndexes) {
          const source = sources[i]!;
          const filter = source.filter;
          if (chainId !== filter.chainId) continue;
          if (filter.type !== "trace") continue;

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
            events.push({
              chainId,
              sourceIndex: i,
              checkpoint: encodeCheckpoint({
                blockTimestamp,
                chainId,
                blockNumber,
                transactionIndex: transaction.transactionIndex,
                eventType: EVENT_TYPES.traces,
                eventIndex: trace.traceIndex,
              }),
              trace,
              block,
              transaction,
              transactionReceipt: shouldGetTransactionReceipt(filter)
                ? transactionReceipt
                : undefined,
            });
          }
        }

        for (const i of transferSourceIndexes) {
          const source = sources[i]!;
          const filter = source.filter;
          if (chainId !== filter.chainId) continue;
          if (filter.type !== "transfer") continue;

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
            events.push({
              chainId,
              sourceIndex: i,
              checkpoint: encodeCheckpoint({
                blockTimestamp,
                chainId,
                blockNumber,
                transactionIndex: transaction.transactionIndex,
                eventType: EVENT_TYPES.traces,
                eventIndex: trace.traceIndex,
              }),
              log: undefined,
              trace,
              block,
              transaction,
              transactionReceipt: shouldGetTransactionReceipt(filter)
                ? transactionReceipt
                : undefined,
            });
          }
        }

        tracesIndex++;
      }

      transactionsIndex++;
    }

    for (const i of blockSourceIndexes) {
      const source = sources[i]!;
      const filter = source.filter;
      if (chainId !== filter.chainId) continue;
      if (filter.type !== "block") continue;

      if (isBlockFilterMatched({ filter, block })) {
        events.push({
          chainId,
          sourceIndex: i,
          checkpoint: encodeCheckpoint({
            blockTimestamp: block.timestamp,
            chainId: BigInt(filter.chainId),
            blockNumber: block.number,
            transactionIndex: MAX_CHECKPOINT.transactionIndex,
            eventType: EVENT_TYPES.blocks,
            eventIndex: ZERO_CHECKPOINT.eventIndex,
          }),
          block,
        });
      }
    }
  }

  // Note: This function relies on the fact that the events are processed in order,
  // so no need to call `.sort()`.

  return events;
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
        chainId: event.chainId,
        checkpoint: encodeCheckpoint({
          ...MAX_CHECKPOINT,
          blockTimestamp: event.event.block.timestamp,
          chainId: BigInt(event.chainId),
          blockNumber: event.event.block.number,
        }),
      });
      hash = event.event.block.hash;
    }

    result[result.length - 1]!.events.push(event);
  }

  return result;
};

/**
 * Decode `RawEvent`s into `Event`s.
 */
export const decodeEvents = (
  common: Common,
  sources: Source[],
  rawEvents: RawEvent[],
): Event[] => {
  const events: Event[] = Array(rawEvents.length);
  let skippedEvents = 0;

  for (let i = 0; i < rawEvents.length; i++) {
    const rawEvent = rawEvents[i]!;
    const source = sources[rawEvent.sourceIndex]!;
    const filter = source.filter;

    switch (source.type) {
      case "contract": {
        switch (filter.type) {
          case "log": {
            try {
              if (
                rawEvent.log!.topics[0] === undefined ||
                source.abiEvents.bySelector[rawEvent.log!.topics[0]] ===
                  undefined
              ) {
                throw new Error();
              }

              const { safeName, item } =
                source.abiEvents.bySelector[rawEvent.log!.topics[0]]!;

              const args = decodeEventLog({
                abiItem: item,
                data: rawEvent.log!.data,
                topics: rawEvent.log!.topics,
              });

              events[i] = {
                type: "log",
                chainId: rawEvent.chainId,
                checkpoint: rawEvent.checkpoint,

                name: `${source.name}:${safeName}`,

                event: {
                  id: rawEvent.checkpoint,
                  args,
                  block: rawEvent.block,
                  transaction: rawEvent.transaction!,
                  transactionReceipt: rawEvent.transactionReceipt,
                  log: rawEvent.log!,
                },
              };
            } catch (err) {
              const blockNumber = rawEvent?.block?.number ?? "unknown";
              const msg = `Unable to decode log, skipping it. blockNumber: ${blockNumber}, logIndex: ${rawEvent.log?.logIndex}, data: ${rawEvent.log?.data}, topics: ${rawEvent.log?.topics}`;
              if (filter.address === undefined) {
                common.logger.debug({ service: "app", msg });
              } else {
                common.logger.warn({ service: "app", msg });
              }

              skippedEvents += 1;
            }
            break;
          }

          case "trace": {
            try {
              const selector = rawEvent
                .trace!.input.slice(0, 10)
                .toLowerCase() as Hex;

              if (source.abiFunctions.bySelector[selector] === undefined) {
                throw new Error();
              }

              const { item, safeName } =
                source.abiFunctions.bySelector[selector]!;

              const { args, functionName } = decodeFunctionData({
                abi: [item],
                data: rawEvent.trace!.input,
              });

              const result = decodeFunctionResult({
                abi: [item],
                data: rawEvent.trace!.output!,
                functionName,
              });

              events[i] = {
                type: "trace",
                chainId: rawEvent.chainId,
                checkpoint: rawEvent.checkpoint,

                // NOTE: `safename` includes ()
                name: `${source.name}.${safeName}`,

                event: {
                  id: rawEvent.checkpoint,
                  args,
                  result,
                  block: rawEvent.block,
                  transaction: rawEvent.transaction!,
                  transactionReceipt: rawEvent.transactionReceipt,
                  trace: rawEvent.trace!,
                },
              };
            } catch (err) {
              const blockNumber = rawEvent?.block?.number ?? "unknown";
              const msg = `Unable to decode trace, skipping it. blockNumber: ${blockNumber}, transactionIndex: ${rawEvent.transaction?.transactionIndex}, traceIndex: ${rawEvent.trace?.traceIndex}, input: ${rawEvent.trace?.input}, output: ${rawEvent.trace?.output}`;
              if (filter.toAddress === undefined) {
                common.logger.debug({ service: "app", msg });
              } else {
                common.logger.warn({ service: "app", msg });
              }

              skippedEvents += 1;
            }
            break;
          }
        }
        break;
      }

      case "account": {
        switch (filter.type) {
          case "transaction": {
            const isFrom = filter.toAddress === undefined;

            events[i] = {
              type: "transaction",
              chainId: rawEvent.chainId,
              checkpoint: rawEvent.checkpoint,

              name: `${source.name}:transaction:${isFrom ? "from" : "to"}`,

              event: {
                id: rawEvent.checkpoint,
                block: rawEvent.block,
                transaction: rawEvent.transaction!,
                transactionReceipt: rawEvent.transactionReceipt,
              },
            };

            break;
          }

          case "transfer": {
            const isFrom = filter.toAddress === undefined;

            events[i] = {
              type: "transfer",
              chainId: rawEvent.chainId,
              checkpoint: rawEvent.checkpoint,

              name: `${source.name}:transfer:${isFrom ? "from" : "to"}`,

              event: {
                id: rawEvent.checkpoint,
                transfer: {
                  from: rawEvent.trace!.from,
                  to: rawEvent.trace!.to!,
                  value: rawEvent.trace!.value!,
                },
                block: rawEvent.block,
                transaction: rawEvent.transaction!,
                transactionReceipt: rawEvent.transactionReceipt,
                trace: rawEvent.trace!,
              },
            };

            break;
          }
        }
        break;
      }

      case "block": {
        events[i] = {
          type: "block",
          chainId: rawEvent.chainId,
          checkpoint: rawEvent.checkpoint,
          name: `${source.name}:block`,
          event: {
            id: rawEvent.checkpoint,
            block: rawEvent.block,
          },
        };
        break;
      }

      default:
        never(source);
    }
  }

  events.length -= skippedEvents;
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
