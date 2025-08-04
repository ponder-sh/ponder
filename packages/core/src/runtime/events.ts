import type {
  BlockFilter,
  Event,
  InternalBlock,
  InternalLog,
  InternalTrace,
  InternalTransaction,
  InternalTransactionReceipt,
  PerChainPonderApp,
  RawEvent,
  SyncBlock,
  SyncBlockHeader,
  SyncLog,
  SyncTrace,
  SyncTransaction,
  SyncTransactionReceipt,
} from "@/internal/types.js";
import type { ChildAddresses } from "@/runtime/index.js";
import {
  EVENT_TYPES,
  MAX_CHECKPOINT,
  ZERO_CHECKPOINT,
  encodeCheckpoint,
} from "@/utils/checkpoint.js";
import { decodeAbiParameters } from "@/utils/decodeAbiParameters.js";
import { toLowerCase } from "@/utils/lowercase.js";
import { never } from "@/utils/never.js";
import type { AbiEvent, AbiFunction, AbiParameter } from "abitype";
import {
  DecodeLogDataMismatch,
  DecodeLogTopicsMismatch,
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
} from "./filter.js";
import { isAddressFactory, shouldGetTransactionReceipt } from "./filter.js";

/**
 * Create `RawEvent`s from raw data types
 */
export const buildEvents = (
  app: PerChainPonderApp,
  {
    blockData: { block, logs, transactions, transactionReceipts, traces },
    childAddresses,
  }: {
    blockData: {
      block: InternalBlock;
      logs: InternalLog[];
      transactions: InternalTransaction[];
      transactionReceipts: InternalTransactionReceipt[];
      traces: InternalTrace[];
    };
    childAddresses: ChildAddresses;
  },
) => {
  const events: RawEvent[] = [];

  const transactionCache = new Map<number, InternalTransaction>();
  const transactionReceiptCache = new Map<number, InternalTransactionReceipt>();
  for (const transaction of transactions) {
    transactionCache.set(transaction.transactionIndex, transaction);
  }
  for (const transactionReceipt of transactionReceipts) {
    transactionReceiptCache.set(
      transactionReceipt.transactionIndex,
      transactionReceipt,
    );
  }

  for (const eventCallback of app.indexingBuild.eventCallbacks) {
    switch (eventCallback.type) {
      case "setup":
        break;

      case "contract": {
        switch (eventCallback.filter.type) {
          case "log": {
            for (const log of logs) {
              if (
                isLogFilterMatched({ filter: eventCallback.filter, log }) &&
                (isAddressFactory(eventCallback.filter.address)
                  ? isAddressMatched({
                      address: log.address,
                      blockNumber: Number(block.number),
                      childAddresses: childAddresses.get(
                        eventCallback.filter.address.id,
                      )!,
                    })
                  : true)
              ) {
                events.push({
                  chain: app.indexingBuild.chain,
                  checkpoint: encodeCheckpoint({
                    blockTimestamp: block.timestamp,
                    chainId: BigInt(eventCallback.filter.chainId),
                    blockNumber: block.number,
                    transactionIndex: BigInt(log.transactionIndex),
                    eventType: EVENT_TYPES.logs,
                    eventIndex: BigInt(log.logIndex),
                  }),
                  eventCallback,
                  log,
                  block,
                  transaction: transactionCache.has(log.transactionIndex)
                    ? transactionCache.get(log.transactionIndex)!
                    : undefined,
                  transactionReceipt:
                    transactionReceiptCache.has(log.transactionIndex) &&
                    shouldGetTransactionReceipt(eventCallback.filter)
                      ? transactionReceiptCache.get(log.transactionIndex)!
                      : undefined,
                  trace: undefined,
                });
              }
            }
            break;
          }

          case "trace": {
            for (const trace of traces) {
              if (
                isTraceFilterMatched({
                  filter: eventCallback.filter,
                  trace,
                  block,
                }) &&
                (isAddressFactory(eventCallback.filter.fromAddress)
                  ? isAddressMatched({
                      address: trace.from,
                      blockNumber: Number(block.number),
                      childAddresses: childAddresses.get(
                        eventCallback.filter.fromAddress.id,
                      )!,
                    })
                  : true) &&
                (isAddressFactory(eventCallback.filter.toAddress)
                  ? isAddressMatched({
                      address: trace.to ?? undefined,
                      blockNumber: Number(block.number),
                      childAddresses: childAddresses.get(
                        eventCallback.filter.toAddress.id,
                      )!,
                    })
                  : true) &&
                (eventCallback.filter.callType === undefined
                  ? true
                  : eventCallback.filter.callType === trace.type) &&
                (eventCallback.filter.includeReverted
                  ? true
                  : trace.error === undefined)
              ) {
                const transaction = transactionCache.get(
                  trace.transactionIndex,
                )!;
                const transactionReceipt = transactionReceiptCache.get(
                  trace.transactionIndex,
                )!;
                events.push({
                  chain: app.indexingBuild.chain,
                  checkpoint: encodeCheckpoint({
                    blockTimestamp: block.timestamp,
                    chainId: BigInt(eventCallback.filter.chainId),
                    blockNumber: block.number,
                    transactionIndex: BigInt(transaction.transactionIndex),
                    eventType: EVENT_TYPES.traces,
                    eventIndex: BigInt(trace.traceIndex),
                  }),
                  eventCallback,
                  log: undefined,
                  trace,
                  block,
                  transaction,
                  transactionReceipt: shouldGetTransactionReceipt(
                    eventCallback.filter,
                  )
                    ? transactionReceipt
                    : undefined,
                });
              }
            }
            break;
          }
        }
        break;
      }

      case "account": {
        switch (eventCallback.filter.type) {
          case "transaction": {
            for (const transaction of transactions) {
              if (
                isTransactionFilterMatched({
                  filter: eventCallback.filter,
                  transaction,
                }) &&
                (isAddressFactory(eventCallback.filter.fromAddress)
                  ? isAddressMatched({
                      address: transaction.from,
                      blockNumber: Number(block.number),
                      childAddresses: childAddresses.get(
                        eventCallback.filter.fromAddress.id,
                      )!,
                    })
                  : true) &&
                (isAddressFactory(eventCallback.filter.toAddress)
                  ? isAddressMatched({
                      address: transaction.to ?? undefined,
                      blockNumber: Number(block.number),
                      childAddresses: childAddresses.get(
                        eventCallback.filter.toAddress.id,
                      )!,
                    })
                  : true) &&
                (eventCallback.filter.includeReverted
                  ? true
                  : transactionReceiptCache.get(transaction.transactionIndex)!
                      .status === "success")
              ) {
                events.push({
                  chain: app.indexingBuild.chain,
                  checkpoint: encodeCheckpoint({
                    blockTimestamp: block.timestamp,
                    chainId: BigInt(eventCallback.filter.chainId),
                    blockNumber: block.number,
                    transactionIndex: BigInt(transaction.transactionIndex),
                    eventType: EVENT_TYPES.transactions,
                    eventIndex: 0n,
                  }),
                  eventCallback,
                  log: undefined,
                  trace: undefined,
                  block,
                  transaction,
                  transactionReceipt: transactionReceiptCache.get(
                    transaction.transactionIndex,
                  )!,
                });
              }
            }
            break;
          }

          case "transfer": {
            for (const trace of traces) {
              if (
                isTransferFilterMatched({
                  filter: eventCallback.filter,
                  trace,
                  block,
                }) &&
                (isAddressFactory(eventCallback.filter.fromAddress)
                  ? isAddressMatched({
                      address: trace.from,
                      blockNumber: Number(block.number),
                      childAddresses: childAddresses.get(
                        eventCallback.filter.fromAddress.id,
                      )!,
                    })
                  : true) &&
                (isAddressFactory(eventCallback.filter.toAddress)
                  ? isAddressMatched({
                      address: trace.to ?? undefined,
                      blockNumber: Number(block.number),
                      childAddresses: childAddresses.get(
                        eventCallback.filter.toAddress.id,
                      )!,
                    })
                  : true) &&
                (eventCallback.filter.includeReverted
                  ? true
                  : trace.error === undefined)
              ) {
                const transaction = transactionCache.get(
                  trace.transactionIndex,
                )!;
                const transactionReceipt = transactionReceiptCache.get(
                  trace.transactionIndex,
                )!;
                events.push({
                  chain: app.indexingBuild.chain,
                  checkpoint: encodeCheckpoint({
                    blockTimestamp: block.timestamp,
                    chainId: BigInt(eventCallback.filter.chainId),
                    blockNumber: block.number,
                    transactionIndex: BigInt(transaction.transactionIndex),
                    eventType: EVENT_TYPES.traces,
                    eventIndex: BigInt(trace.traceIndex),
                  }),
                  eventCallback,
                  log: undefined,
                  trace,
                  block,
                  transaction,
                  transactionReceipt: shouldGetTransactionReceipt(
                    eventCallback.filter,
                  )
                    ? transactionReceipt
                    : undefined,
                });
              }
            }
            break;
          }
        }
        break;
      }

      case "block": {
        if (
          isBlockFilterMatched({
            filter: eventCallback.filter as BlockFilter,
            block,
          })
        ) {
          events.push({
            chain: app.indexingBuild.chain,
            checkpoint: encodeCheckpoint({
              blockTimestamp: block.timestamp,
              chainId: BigInt(eventCallback.filter.chainId),
              blockNumber: block.number,
              transactionIndex: MAX_CHECKPOINT.transactionIndex,
              eventType: EVENT_TYPES.blocks,
              eventIndex: ZERO_CHECKPOINT.eventIndex,
            }),
            eventCallback,
            block,
            log: undefined,
            trace: undefined,
            transaction: undefined,
            transactionReceipt: undefined,
          });
        }
        break;
      }
      default:
        never(eventCallback);
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
  app: Pick<PerChainPonderApp, "common" | "indexingBuild">,
  { rawEvents }: { rawEvents: RawEvent[] },
): Event[] => {
  const events: Event[] = [];

  for (const event of rawEvents) {
    switch (event.eventCallback.type) {
      case "setup":
        break;

      case "contract": {
        switch (event.eventCallback.filter.type) {
          case "log": {
            try {
              if (event.log!.topics[0] === undefined) {
                throw new Error();
              }

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
                  block: event.block,
                  transaction: event.transaction!,
                  transactionReceipt: event.transactionReceipt,
                },
              });
            } catch (err) {
              const blockNumber = event?.block?.number ?? "unknown";
              const msg = `Unable to decode log, skipping it. blockNumber: ${blockNumber}, logIndex: ${event.log?.logIndex}, data: ${event.log?.data}, topics: ${event.log?.topics}`;
              if (event.eventCallback.filter.address === undefined) {
                app.common.logger.debug({ service: "app", msg });
              } else {
                app.common.logger.warn({ service: "app", msg });
              }
            }
            break;
          }

          case "trace": {
            try {
              const { args, functionName } = decodeFunctionData({
                abi: [event.eventCallback.abiItem as AbiFunction],
                data: event.trace!.input,
              });

              const result = decodeFunctionResult({
                abi: [event.eventCallback.abiItem as AbiFunction],
                data: event.trace!.output!,
                functionName,
              });

              events.push({
                type: "trace",
                chain: event.chain,
                eventCallback: event.eventCallback,
                checkpoint: event.checkpoint,

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
              const msg = `Unable to decode trace, skipping it. blockNumber: ${blockNumber}, transactionIndex: ${event.trace?.transactionIndex}, traceIndex: ${event.trace?.traceIndex}, input: ${event.trace?.input}, output: ${event.trace?.output}`;
              if (event.eventCallback.filter.toAddress === undefined) {
                app.common.logger.debug({ service: "app", msg });
              } else {
                app.common.logger.warn({ service: "app", msg });
              }
            }
            break;
          }
        }
        break;
      }

      case "account": {
        switch (event.eventCallback.filter.type) {
          case "transaction": {
            events.push({
              type: "transaction",
              chain: event.chain,
              eventCallback: event.eventCallback,
              checkpoint: event.checkpoint,

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
          chain: event.chain,
          checkpoint: event.checkpoint,
          eventCallback: event.eventCallback,
          event: {
            id: event.checkpoint,
            block: event.block,
          },
        });
        break;
      }

      default:
        never(event.eventCallback);
    }
  }

  return events;
};

/** @see https://github.com/wevm/viem/blob/main/src/utils/abi/decodeEventLog.ts#L99 */
export function decodeEventLog({
  abiItem,
  topics,
  data,
}: {
  abiItem: AbiEvent;
  topics: [signature: Hex, ...args: Hex[]] | [];
  data: Hex;
}): any {
  const { inputs } = abiItem;
  const isUnnamed = inputs?.some((x) => !("name" in x && x.name));

  let args: any = isUnnamed ? [] : {};

  const [, ...argTopics] = topics;

  // Decode topics (indexed args).
  const indexedInputs = inputs.filter((x) => "indexed" in x && x.indexed);
  for (let i = 0; i < indexedInputs.length; i++) {
    const param = indexedInputs[i]!;
    const topic = argTopics[i];
    if (!topic)
      throw new DecodeLogTopicsMismatch({
        abiItem,
        param: param as AbiParameter & { indexed: boolean },
      });
    args[isUnnamed ? i : param.name || i] = decodeTopic({
      param,
      value: topic,
    });
  }

  // Decode data (non-indexed args).
  const nonIndexedInputs = inputs.filter((x) => !("indexed" in x && x.indexed));
  if (nonIndexedInputs.length > 0) {
    if (data && data !== "0x") {
      const decodedData = decodeAbiParameters(nonIndexedInputs, data);
      if (decodedData) {
        if (isUnnamed) args = [...args, ...decodedData];
        else {
          for (let i = 0; i < nonIndexedInputs.length; i++) {
            args[nonIndexedInputs[i]!.name!] = decodedData[i];
          }
        }
      }
    } else {
      throw new DecodeLogDataMismatch({
        abiItem,
        data: "0x",
        params: nonIndexedInputs,
        size: 0,
      });
    }
  }

  return Object.values(args).length > 0 ? args : undefined;
}

const ARRAY_REGEX = /^(.*)\[(\d+)?\]$/;

function decodeTopic({ param, value }: { param: AbiParameter; value: Hex }) {
  if (
    param.type === "string" ||
    param.type === "bytes" ||
    param.type === "tuple" ||
    param.type.match(ARRAY_REGEX)
  )
    return value;
  const decodedArg = decodeAbiParameters([param], value) || [];
  return decodedArg[0];
}

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
