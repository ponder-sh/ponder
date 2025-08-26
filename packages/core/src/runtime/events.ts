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
 * Create `RawEvent`s from raw data types
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

  let logsIndex = 0;
  let transactionsIndex = 0;
  let transactionReceiptsIndex = 0;
  let tracesIndex = 0;

  for (const block of blocks) {
    const blockNumber = Number(block.number);
    const blockTimestamp = Number(block.timestamp);
    while (
      transactionsIndex < transactions.length &&
      transactions[transactionsIndex]!.blockNumber === blockNumber
    ) {
      const transaction = transactions[transactionsIndex]!;

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

      // TODO(kyle) transaction may be undefined for zkSync

      for (let i = 0; i < sources.length; i++) {
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
            log: undefined,
            trace: undefined,
            block,
            transaction,
            transactionReceipt: transactionReceipt!,
          });
        }
      }

      while (
        logsIndex < logs.length &&
        logs[logsIndex]!.blockNumber === blockNumber &&
        logs[logsIndex]!.transactionIndex === transaction.transactionIndex
      ) {
        const log = logs[logsIndex]!;

        for (let i = 0; i < sources.length; i++) {
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
              trace: undefined,
            });
          }
        }

        logsIndex++;
      }

      while (
        tracesIndex < traces.length &&
        traces[tracesIndex]!.blockNumber === blockNumber &&
        traces[tracesIndex]!.transactionIndex === transaction.transactionIndex
      ) {
        const trace = traces[tracesIndex]!;

        for (let i = 0; i < sources.length; i++) {
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

        for (let i = 0; i < sources.length; i++) {
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

    for (let i = 0; i < sources.length; i++) {
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
          log: undefined,
          trace: undefined,
          transaction: undefined,
          transactionReceipt: undefined,
        });
      }
    }
  }

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

export const decodeEvents = (
  common: Common,
  sources: Source[],
  rawEvents: RawEvent[],
): Event[] => {
  // TODO(kyle) improve memory usage
  const events: Event[] = [];

  for (const event of rawEvents) {
    const source = sources[event.sourceIndex]!;

    switch (source.type) {
      case "contract": {
        switch (source.filter.type) {
          case "log": {
            try {
              if (
                event.log!.topics[0] === undefined ||
                source.abiEvents.bySelector[event.log!.topics[0]] === undefined
              ) {
                throw new Error();
              }

              const { safeName, item } =
                source.abiEvents.bySelector[event.log!.topics[0]]!;

              const args = decodeEventLog({
                abiItem: item,
                data: event.log!.data,
                topics: event.log!.topics,
              });

              events.push({
                type: "log",
                chainId: event.chainId,
                checkpoint: event.checkpoint,

                name: `${source.name}:${safeName}`,

                event: {
                  id: event.checkpoint,
                  args,
                  log: event.log!,
                  block: event.block,
                  transaction: event.transaction!,
                  transactionReceipt: event.transactionReceipt,
                },
              });
            } catch (err) {
              const blockNumber = event?.block?.number ?? "unknown";
              const msg = `Unable to decode log, skipping it. blockNumber: ${blockNumber}, logIndex: ${event.log?.logIndex}, data: ${event.log?.data}, topics: ${event.log?.topics}`;
              if (source.filter.address === undefined) {
                common.logger.debug({ service: "app", msg });
              } else {
                common.logger.warn({ service: "app", msg });
              }
            }
            break;
          }

          case "trace": {
            try {
              const selector = event
                .trace!.input.slice(0, 10)
                .toLowerCase() as Hex;

              if (source.abiFunctions.bySelector[selector] === undefined) {
                throw new Error();
              }

              const { item, safeName } =
                source.abiFunctions.bySelector[selector]!;

              const { args, functionName } = decodeFunctionData({
                abi: [item],
                data: event.trace!.input,
              });

              const result = decodeFunctionResult({
                abi: [item],
                data: event.trace!.output!,
                functionName,
              });

              events.push({
                type: "trace",
                chainId: event.chainId,
                checkpoint: event.checkpoint,

                // NOTE: `safename` includes ()
                name: `${source.name}.${safeName}`,

                event: {
                  id: event.checkpoint,
                  args,
                  result,
                  trace: event.trace!,
                  block: event.block,
                  transaction: event.transaction!,
                  transactionReceipt: event.transactionReceipt,
                },
              });
            } catch (err) {
              const blockNumber = event?.block?.number ?? "unknown";
              const msg = `Unable to decode trace, skipping it. blockNumber: ${blockNumber}, transactionIndex: ${event.transaction?.transactionIndex}, traceIndex: ${event.trace?.traceIndex}, input: ${event.trace?.input}, output: ${event.trace?.output}`;
              if (source.filter.toAddress === undefined) {
                common.logger.debug({ service: "app", msg });
              } else {
                common.logger.warn({ service: "app", msg });
              }
            }
            break;
          }

          default:
            never(source.filter);
        }
        break;
      }

      case "account": {
        switch (source.filter.type) {
          case "transaction": {
            const isFrom = source.filter.toAddress === undefined;

            events.push({
              type: "transaction",
              chainId: event.chainId,
              checkpoint: event.checkpoint,

              name: `${source.name}:transaction:${isFrom ? "from" : "to"}`,

              event: {
                id: event.checkpoint,
                block: event.block,
                transaction: event.transaction!,
                transactionReceipt: event.transactionReceipt,
              },
            });

            break;
          }

          case "transfer": {
            const isFrom = source.filter.toAddress === undefined;

            events.push({
              type: "transfer",
              chainId: event.chainId,
              checkpoint: event.checkpoint,

              name: `${source.name}:transfer:${isFrom ? "from" : "to"}`,

              event: {
                id: event.checkpoint,
                transfer: {
                  from: event.trace!.from,
                  to: event.trace!.to!,
                  value: event.trace!.value!,
                },
                block: event.block,
                transaction: event.transaction!,
                transactionReceipt: event.transactionReceipt,
                trace: event.trace!,
              },
            });

            break;
          }
        }
        break;
      }

      case "block": {
        events.push({
          type: "block",
          chainId: event.chainId,
          checkpoint: event.checkpoint,
          name: `${source.name}:block`,
          event: {
            id: event.checkpoint,
            block: event.block,
          },
        });
        break;
      }

      default:
        never(source);
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
