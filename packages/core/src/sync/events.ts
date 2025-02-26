import type { Common } from "@/internal/common.js";
import type {
  BlockFilter,
  Event,
  Factory,
  RawEvent,
  Source,
} from "@/internal/types.js";
import type { BlockWithEventData } from "@/sync-realtime/index.js";
import type {
  Block,
  Log,
  Trace,
  Transaction,
  TransactionReceipt,
} from "@/types/eth.js";
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
import { never } from "@/utils/never.js";
import { startClock } from "@/utils/timer.js";
import type { AbiEvent, AbiParameter } from "abitype";
import {
  type Address,
  DecodeLogDataMismatch,
  DecodeLogTopicsMismatch,
  type Hash,
  type Hex,
  checksumAddress,
  decodeAbiParameters,
  decodeFunctionData,
  decodeFunctionResult,
  hexToBigInt,
  hexToNumber,
} from "viem";
import {
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
export const buildEvents = ({
  sources,
  blockWithEventData: {
    block,
    logs,
    transactions,
    transactionReceipts,
    traces,
  },
  finalizedChildAddresses,
  unfinalizedChildAddresses,
  chainId,
}: {
  sources: Source[];
  blockWithEventData: Omit<BlockWithEventData, "filters" | "factoryLogs">;
  finalizedChildAddresses: Map<Factory, Set<Address>>;
  unfinalizedChildAddresses: Map<Factory, Set<Address>>;
  chainId: number;
}) => {
  const events: RawEvent[] = [];

  const transactionCache = new Map<Hash, SyncTransaction>();
  const transactionReceiptCache = new Map<Hash, SyncTransactionReceipt>();
  for (const transaction of transactions) {
    transactionCache.set(transaction.hash, transaction);
  }
  for (const transactionReceipt of transactionReceipts) {
    transactionReceiptCache.set(
      transactionReceipt.transactionHash,
      transactionReceipt,
    );
  }

  for (let i = 0; i < sources.length; i++) {
    const source = sources[i]!;
    const filter = source.filter;
    if (chainId !== filter.chainId) continue;
    switch (source.type) {
      case "contract": {
        switch (filter.type) {
          case "log": {
            for (const log of logs) {
              if (
                isLogFilterMatched({ filter, block, log }) &&
                (isAddressFactory(filter.address)
                  ? finalizedChildAddresses
                      .get(filter.address)!
                      .has(log.address) ||
                    unfinalizedChildAddresses
                      .get(filter.address)!
                      .has(log.address)
                  : true)
              ) {
                events.push({
                  chainId: filter.chainId,
                  sourceIndex: i,
                  checkpoint: encodeCheckpoint({
                    blockTimestamp: hexToNumber(block.timestamp),
                    chainId: BigInt(filter.chainId),
                    blockNumber: hexToBigInt(log.blockNumber),
                    transactionIndex: hexToBigInt(log.transactionIndex),
                    eventType: EVENT_TYPES.logs,
                    eventIndex: hexToBigInt(log.logIndex),
                  }),
                  log: convertLog(log),
                  block: convertBlock(block),
                  transaction: transactionCache.has(log.transactionHash)
                    ? convertTransaction(
                        transactionCache.get(log.transactionHash)!,
                      )
                    : undefined,
                  transactionReceipt:
                    transactionReceiptCache.has(log.transactionHash) &&
                    shouldGetTransactionReceipt(filter)
                      ? convertTransactionReceipt(
                          transactionReceiptCache.get(log.transactionHash)!,
                        )
                      : undefined,
                  trace: undefined,
                });
              }
            }
            break;
          }

          case "trace": {
            for (const trace of traces) {
              const fromChildAddresses = isAddressFactory(filter.fromAddress)
                ? [
                    finalizedChildAddresses.get(filter.fromAddress)!,
                    unfinalizedChildAddresses.get(filter.fromAddress)!,
                  ]
                : undefined;

              const toChildAddresses = isAddressFactory(filter.toAddress)
                ? [
                    finalizedChildAddresses.get(filter.toAddress)!,
                    unfinalizedChildAddresses.get(filter.toAddress)!,
                  ]
                : undefined;

              if (
                isTraceFilterMatched({
                  filter,
                  block,
                  trace: trace.trace,
                  fromChildAddresses,
                  toChildAddresses,
                }) &&
                (filter.callType === undefined
                  ? true
                  : filter.callType === trace.trace.type) &&
                (filter.includeReverted
                  ? true
                  : trace.trace.error === undefined)
              ) {
                const transaction = transactionCache.get(
                  trace.transactionHash,
                )!;
                const transactionReceipt = transactionReceiptCache.get(
                  trace.transactionHash,
                )!;
                events.push({
                  chainId: filter.chainId,
                  sourceIndex: i,
                  checkpoint: encodeCheckpoint({
                    blockTimestamp: hexToNumber(block.timestamp),
                    chainId: BigInt(filter.chainId),
                    blockNumber: hexToBigInt(block.number),
                    transactionIndex: BigInt(transaction.transactionIndex),
                    eventType: EVENT_TYPES.traces,
                    eventIndex: BigInt(trace.trace.index),
                  }),
                  log: undefined,
                  trace: convertTrace(trace),
                  block: convertBlock(block),
                  transaction: convertTransaction(transaction),
                  transactionReceipt: shouldGetTransactionReceipt(filter)
                    ? convertTransactionReceipt(transactionReceipt)
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
        switch (filter.type) {
          case "transaction": {
            for (const transaction of transactions) {
              const fromChildAddresses = isAddressFactory(filter.fromAddress)
                ? [
                    finalizedChildAddresses.get(filter.fromAddress)!,
                    unfinalizedChildAddresses.get(filter.fromAddress)!,
                  ]
                : undefined;

              const toChildAddresses = isAddressFactory(filter.toAddress)
                ? [
                    finalizedChildAddresses.get(filter.toAddress)!,
                    unfinalizedChildAddresses.get(filter.toAddress)!,
                  ]
                : undefined;

              if (
                isTransactionFilterMatched({
                  filter,
                  block,
                  transaction,
                  fromChildAddresses,
                  toChildAddresses,
                }) &&
                (filter.includeReverted
                  ? true
                  : transactionReceiptCache.get(transaction.hash)!.status ===
                    "0x1")
              ) {
                events.push({
                  chainId: filter.chainId,
                  sourceIndex: i,
                  checkpoint: encodeCheckpoint({
                    blockTimestamp: hexToNumber(block.timestamp),
                    chainId: BigInt(filter.chainId),
                    blockNumber: hexToBigInt(block.number),
                    transactionIndex: BigInt(transaction.transactionIndex),
                    eventType: EVENT_TYPES.transactions,
                    eventIndex: 0n,
                  }),
                  log: undefined,
                  trace: undefined,
                  block: convertBlock(block),
                  transaction: convertTransaction(transaction),
                  transactionReceipt: convertTransactionReceipt(
                    transactionReceiptCache.get(transaction.hash)!,
                  ),
                });
              }
            }
            break;
          }

          case "transfer": {
            for (const trace of traces) {
              const fromChildAddresses = isAddressFactory(filter.fromAddress)
                ? [
                    finalizedChildAddresses.get(filter.fromAddress)!,
                    unfinalizedChildAddresses.get(filter.fromAddress)!,
                  ]
                : undefined;

              const toChildAddresses = isAddressFactory(filter.toAddress)
                ? [
                    finalizedChildAddresses.get(filter.toAddress)!,
                    unfinalizedChildAddresses.get(filter.toAddress)!,
                  ]
                : undefined;

              if (
                isTransferFilterMatched({
                  filter,
                  block,
                  trace: trace.trace,
                  fromChildAddresses,
                  toChildAddresses,
                }) &&
                (filter.includeReverted
                  ? true
                  : trace.trace.error === undefined)
              ) {
                const transaction = transactionCache.get(
                  trace.transactionHash,
                )!;
                const transactionReceipt = transactionReceiptCache.get(
                  trace.transactionHash,
                )!;
                events.push({
                  chainId: filter.chainId,
                  sourceIndex: i,
                  checkpoint: encodeCheckpoint({
                    blockTimestamp: hexToNumber(block.timestamp),
                    chainId: BigInt(filter.chainId),
                    blockNumber: hexToBigInt(block.number),
                    transactionIndex: BigInt(transaction.transactionIndex),
                    eventType: EVENT_TYPES.traces,
                    eventIndex: BigInt(trace.trace.index),
                  }),
                  log: undefined,
                  trace: convertTrace(trace),
                  block: convertBlock(block),
                  transaction: convertTransaction(transaction),
                  transactionReceipt: shouldGetTransactionReceipt(filter)
                    ? convertTransactionReceipt(transactionReceipt)
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
        if (isBlockFilterMatched({ filter: filter as BlockFilter, block })) {
          events.push({
            chainId: filter.chainId,
            sourceIndex: i,
            checkpoint: encodeCheckpoint({
              blockTimestamp: hexToNumber(block.timestamp),
              chainId: BigInt(filter.chainId),
              blockNumber: hexToBigInt(block.number),
              transactionIndex: MAX_CHECKPOINT.transactionIndex,
              eventType: EVENT_TYPES.blocks,
              eventIndex: ZERO_CHECKPOINT.eventIndex,
            }),
            block: convertBlock(block),
            log: undefined,
            trace: undefined,
            transaction: undefined,
            transactionReceipt: undefined,
          });
        }
        break;
      }
      default:
        never(source);
    }
  }

  return events.sort((a, b) => (a.checkpoint < b.checkpoint ? -1 : 1));
};

export const decodeEvents = (
  common: Common,
  sources: Source[],
  rawEvents: RawEvent[],
): Event[] => {
  const events: Event[] = [];

  const endClock = startClock();

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
                  name: safeName,
                  args: removeNullCharacters(args),
                  log: event.log!,
                  block: event.block,
                  transaction: event.transaction!,
                  transactionReceipt: event.transactionReceipt,
                },
              });
            } catch (err) {
              if (source.filter.address === undefined) {
                common.logger.debug({
                  service: "app",
                  msg: `Unable to decode log, skipping it. id: ${event.log?.id}, data: ${event.log?.data}, topics: ${event.log?.topics}`,
                });
              } else {
                common.logger.warn({
                  service: "app",
                  msg: `Unable to decode log, skipping it. id: ${event.log?.id}, data: ${event.log?.data}, topics: ${event.log?.topics}`,
                });
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
                  args: removeNullCharacters(args),
                  result: removeNullCharacters(result),
                  trace: event.trace!,
                  block: event.block,
                  transaction: event.transaction!,
                  transactionReceipt: event.transactionReceipt,
                },
              });
            } catch (err) {
              if (source.filter.toAddress === undefined) {
                common.logger.debug({
                  service: "app",
                  msg: `Unable to decode trace, skipping it. id: ${event.trace?.id}, input: ${event.trace?.input}, output: ${event.trace?.output}`,
                });
              } else {
                common.logger.warn({
                  service: "app",
                  msg: `Unable to decode trace, skipping it. id: ${event.trace?.id}, input: ${event.trace?.input}, output: ${event.trace?.output}`,
                });
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
            block: event.block,
          },
        });
        break;
      }

      default:
        never(source);
    }
  }

  common.metrics.ponder_indexing_abi_decoding_duration.observe(endClock());

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

function decodeTopic({ param, value }: { param: AbiParameter; value: Hex }) {
  if (
    param.type === "string" ||
    param.type === "bytes" ||
    param.type === "tuple" ||
    param.type.match(/^(.*)\[(\d+)?\]$/)
  )
    return value;
  const decodedArg = decodeAbiParameters([param], value) || [];
  return decodedArg[0];
}

export function removeNullCharacters(obj: unknown): unknown {
  if (typeof obj === "string") {
    return obj.replace(/\0/g, "");
  }
  if (Array.isArray(obj)) {
    // Recursively handle array elements
    return obj.map(removeNullCharacters);
  }
  if (obj && typeof obj === "object") {
    // Recursively handle object properties
    const newObj: { [key: string]: unknown } = {};
    for (const [key, val] of Object.entries(obj)) {
      newObj[key] = removeNullCharacters(val);
    }
    return newObj;
  }
  // For other types (number, boolean, null, undefined, etc.), return as-is
  return obj;
}

const convertBlock = (block: SyncBlock): Block => ({
  baseFeePerGas: block.baseFeePerGas ? hexToBigInt(block.baseFeePerGas) : null,
  difficulty: hexToBigInt(block.difficulty),
  extraData: block.extraData,
  gasLimit: hexToBigInt(block.gasLimit),
  gasUsed: hexToBigInt(block.gasUsed),
  hash: block.hash,
  logsBloom: block.logsBloom,
  miner: checksumAddress(block.miner),
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

const convertLog = (log: SyncLog): Log => ({
  id: `${log.blockHash}-${log.logIndex}`,
  address: checksumAddress(log.address!),
  data: log.data,
  logIndex: Number(log.logIndex),
  removed: false,
  topics: log.topics,
});

const convertTransaction = (transaction: SyncTransaction): Transaction => ({
  from: checksumAddress(transaction.from),
  gas: hexToBigInt(transaction.gas),
  hash: transaction.hash,
  input: transaction.input,
  nonce: Number(transaction.nonce),
  r: transaction.r,
  s: transaction.s,
  to: transaction.to ? checksumAddress(transaction.to) : transaction.to,
  transactionIndex: Number(transaction.transactionIndex),
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

const convertTransactionReceipt = (
  transactionReceipt: SyncTransactionReceipt,
): TransactionReceipt => ({
  contractAddress: transactionReceipt.contractAddress
    ? checksumAddress(transactionReceipt.contractAddress)
    : null,
  cumulativeGasUsed: hexToBigInt(transactionReceipt.cumulativeGasUsed),
  effectiveGasPrice: hexToBigInt(transactionReceipt.effectiveGasPrice),
  from: checksumAddress(transactionReceipt.from),
  gasUsed: hexToBigInt(transactionReceipt.gasUsed),
  logsBloom: transactionReceipt.logsBloom,
  status:
    transactionReceipt.status === "0x1"
      ? "success"
      : transactionReceipt.status === "0x0"
        ? "reverted"
        : (transactionReceipt.status as TransactionReceipt["status"]),
  to: transactionReceipt.to ? checksumAddress(transactionReceipt.to) : null,
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

const convertTrace = (trace: SyncTrace): Trace => ({
  id: `${trace.transactionHash}-${trace.trace.index}`,
  type: trace.trace.type,
  from: checksumAddress(trace.trace.from),
  to: trace.trace.to ? checksumAddress(trace.trace.to) : null,
  input: trace.trace.input,
  output: trace.trace.output,
  gas: hexToBigInt(trace.trace.gas),
  gasUsed: hexToBigInt(trace.trace.gasUsed),
  value: trace.trace.value ? hexToBigInt(trace.trace.value) : null,
  traceIndex: trace.trace.index,
  subcalls: trace.trace.subcalls,
});
