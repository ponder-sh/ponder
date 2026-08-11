import { getLogsRetryHelper } from "@ponder/utils";
import {
  type Address,
  type Hash,
  type Hex,
  hexToNumber,
  numberToHex,
  type RpcError,
  toHex,
  zeroHash,
} from "viem";
import type { Common } from "@/internal/common.js";
import type {
  BlockFilter,
  Chain,
  Factory,
  FactoryId,
  LogFilter,
  SyncBlock,
  SyncLog,
  SyncTrace,
  SyncTransaction,
  SyncTransactionReceipt,
  TraceFilter,
  TransactionFilter,
  TransferFilter,
} from "@/internal/types.js";
import {
  debug_traceBlockByNumber,
  eth_getBlockByNumber,
  eth_getBlockReceipts,
  eth_getLogs,
  eth_getTransactionReceipt,
  validateLogsAndBlock,
  validateReceiptsAndBlock,
  validateTracesAndBlock,
  validateTransactionsAndBlock,
} from "@/rpc/actions.js";
import {
  type RequestParameters,
  type Rpc,
  sanitizeLogTopics,
} from "@/rpc/index.js";
import {
  getChildAddress,
  isAddressFactory,
  isAddressMatched,
  isBlockFilterMatched,
  isBlockInFilter,
  isLogFactoryMatched,
  isLogFilterMatched,
  isTraceFilterMatched,
  isTransactionFilterMatched,
  isTransferFilterMatched,
} from "@/runtime/filter.js";
import type {
  ChildAddresses,
  IntervalWithFactory,
  IntervalWithFilter,
} from "@/runtime/index.js";
import type { SyncStore } from "@/sync-store/index.js";
import { dedupe } from "@/utils/dedupe.js";
import {
  getChunks,
  type Interval,
  intervalBounds,
  intervalRange,
} from "@/utils/interval.js";
import { promiseAllSettledWithThrow } from "@/utils/promiseAllSettledWithThrow.js";
import { createQueue } from "@/utils/queue.js";
import { startClock } from "@/utils/timer.js";

type LogRequestParams = {
  fromBlock: number;
  toBlock: number;
  address: Hex | Hex[] | undefined;
  topic0: Hex | Hex[] | undefined;
  topic1: Hex | Hex[] | undefined;
  topic2: Hex | Hex[] | undefined;
  topic3: Hex | Hex[] | undefined;
  filters: LogFilter[];
};

const logRequestKeys = [
  "address",
  "topic0",
  "topic1",
  "topic2",
  "topic3",
] as const;

/** Returns `true` if `left` and `right` overlap by at least 80% of the smaller interval's length. */
const hasSufficientLogIntervalOverlap = (
  left: Interval,
  right: Interval,
): boolean => {
  const overlapStart = Math.max(left[0], right[0]);
  const overlapEnd = Math.min(left[1], right[1]);
  if (overlapStart > overlapEnd) return false;

  const overlapLength = overlapEnd - overlapStart + 1;
  const smallerIntervalLength = Math.min(
    left[1] - left[0] + 1,
    right[1] - right[0] + 1,
  );

  return overlapLength / smallerIntervalLength >= 0.8;
};

const mergeLogFilterValue = <value extends Hex>(
  left: value | value[] | undefined,
  right: value | value[] | undefined,
): value[] | undefined =>
  left === undefined || right === undefined
    ? undefined
    : [
        ...new Set([
          ...(Array.isArray(left) ? left : [left]),
          ...(Array.isArray(right) ? right : [right]),
        ]),
      ];

/**
 * Merge `LogFilter`s into the smallest possible set of "eth_getLogs" requests.
 *
 * @dev Two filters are merged into a single request when:
 *   1. their required intervals overlap by at least 80% (of the smaller
 *      interval's length), and
 *   2. at most one of `address`, `topic0`, `topic1`, `topic2`, or `topic3`
 *      differs between them.
 * The one differing dimension (if any) is unioned into an array.
 *
 * @dev Factory addresses are resolved into concrete child addresses (or
 * `undefined`, above `factoryAddressCountThreshold`) before merging, so
 * requests originating from different factories can still be merged.
 */
export const mergeLogFiltersToRequests = (
  filters: IntervalWithFilter[],
  childAddresses: ChildAddresses,
  factoryAddressCountThreshold: number,
): (Extract<RequestParameters, { method: "eth_getLogs" }> & {
  filters: LogFilter[];
})[] => {
  const requests: LogRequestParams[] = [];

  for (const { filter, interval } of filters) {
    if (filter.type !== "log") continue;

    let address: Hex | Hex[] | undefined;
    if (isAddressFactory(filter.address)) {
      const addresses = childAddresses.get(filter.address.id)!;
      if (addresses.size === 0) continue;

      address =
        addresses.size >= factoryAddressCountThreshold
          ? undefined
          : Array.from(addresses.keys());
    } else {
      address = filter.address;
    }

    const candidate = {
      address,
      topic0: filter.topic0,
      topic1: filter.topic1 ?? undefined,
      topic2: filter.topic2 ?? undefined,
      topic3: filter.topic3 ?? undefined,
    };

    let isMerged = false;

    for (const request of requests) {
      if (
        hasSufficientLogIntervalOverlap(
          [request.fromBlock, request.toBlock],
          interval,
        ) === false
      ) {
        continue;
      }

      const numberOfDifferences = logRequestKeys.filter(
        (key) =>
          JSON.stringify(request[key]) !== JSON.stringify(candidate[key]),
      ).length;
      if (numberOfDifferences > 1) continue;

      for (const key of logRequestKeys) {
        if (JSON.stringify(request[key]) === JSON.stringify(candidate[key])) {
          continue;
        }
        request[key] = mergeLogFilterValue(request[key], candidate[key]);
      }

      request.fromBlock = Math.min(request.fromBlock, interval[0]);
      request.toBlock = Math.max(request.toBlock, interval[1]);
      request.filters.push(filter);
      isMerged = true;
      break;
    }

    if (isMerged === false) {
      requests.push({
        fromBlock: interval[0],
        toBlock: interval[1],
        ...candidate,
        filters: [filter],
      });
    }
  }

  return requests.map(({ fromBlock, toBlock, filters, ...filter }) => ({
    method: "eth_getLogs" as const,
    params: [
      {
        address: filter.address as Address | Address[] | undefined,
        topics: sanitizeLogTopics([
          filter.topic0 ?? null,
          filter.topic1 ?? null,
          filter.topic2 ?? null,
          filter.topic3 ?? null,
        ]),
        fromBlock: numberToHex(fromBlock),
        toBlock: numberToHex(toBlock),
      },
    ],
    filters,
  }));
};

export type HistoricalSync = {
  /**
   * Sync block data that can be queried for a range of blocks (logs).
   */
  syncBlockRangeData(params: {
    interval: Interval;
    requiredIntervals: IntervalWithFilter[];
    requiredFactoryIntervals: IntervalWithFactory[];
    syncStore: SyncStore;
  }): Promise<SyncLog[]>;
  /**
   * Sync block data that must be queried for a single block (block, transactions, receipts, traces).
   * @returns Closest-to-tip synced block.
   */
  syncBlockData(params: {
    interval: Interval;
    requiredIntervals: IntervalWithFilter[];
    logs: SyncLog[];
    syncStore: SyncStore;
  }): Promise<SyncBlock | undefined>;
};

type CreateHistoricalSyncParameters = {
  common: Common;
  chain: Chain;
  rpc: Rpc;
  childAddresses: Map<FactoryId, Map<Address, number>>;
};

export const createHistoricalSync = (
  args: CreateHistoricalSyncParameters,
): HistoricalSync => {
  /**
   * Flag to fetch transaction receipts through eth_getBlockReceipts (true) or eth_getTransactionReceipt (false)
   */
  let isBlockReceipts = true;

  /**
   * Data about the range passed to "eth_getLogs" share among all log
   * filters and log factories.
   */
  let logsRequestMetadata: {
    /** Estimate optimal range to use for "eth_getLogs" requests */
    estimatedRange: number;
    /** Range suggested by an error message */
    confirmedRange?: number;
  } = {
    estimatedRange: 500,
  };

  ////////
  // Helper functions for sync tasks
  ////////

  /**
   * Split "eth_getLogs" requests into ranges inferred from errors
   * and batch requests.
   */
  const syncLogsDynamic = async (
    params: Extract<RequestParameters, { method: "eth_getLogs" }>["params"][0],
    context?: Parameters<Rpc["request"]>[1],
  ): Promise<SyncLog[]> => {
    const { address, topics } = params;

    const intervals = getChunks({
      interval: [
        hexToNumber(params.fromBlock as Hex),
        hexToNumber(params.toBlock as Hex),
      ],
      maxChunkSize:
        args.chain.ethGetLogsBlockRange ??
        logsRequestMetadata.confirmedRange ??
        logsRequestMetadata.estimatedRange,
    });

    const logs = await Promise.all(
      intervals.map(([fromBlock, toBlock]) =>
        eth_getLogs(
          args.rpc,
          [
            {
              address,
              topics,
              fromBlock: numberToHex(fromBlock),
              toBlock: numberToHex(toBlock),
            },
          ],
          context,
        ).catch((error) => {
          // Note: skip eth_getLogs range retry logic if the chain
          // has a custom block range.
          if (args.chain.ethGetLogsBlockRange !== undefined) {
            throw error;
          }

          const getLogsErrorResponse = getLogsRetryHelper({
            params: [
              {
                address,
                topics,
                fromBlock: toHex(fromBlock),
                toBlock: toHex(toBlock),
              },
            ],
            error: error as RpcError,
          });

          if (getLogsErrorResponse.shouldRetry === false) throw error;

          const range =
            hexToNumber(getLogsErrorResponse.ranges[0]!.toBlock) -
            hexToNumber(getLogsErrorResponse.ranges[0]!.fromBlock);

          args.common.logger.debug({
            msg: "Updated eth_getLogs range",
            chain: args.chain.name,
            chain_id: args.chain.id,
            range,
          });

          logsRequestMetadata = {
            estimatedRange: range,
            confirmedRange: getLogsErrorResponse.isSuggestedRange
              ? range
              : undefined,
          };

          return syncLogsDynamic(
            {
              address,
              topics,
              fromBlock: numberToHex(fromBlock),
              toBlock: numberToHex(toBlock),
            },
            context,
          );
        }),
      ),
    ).then((logs) => logs.flat());

    /**
     * Dynamically increase the range used in "eth_getLogs" if an
     * error has been received but the error didn't suggest a range.
     */

    if (logsRequestMetadata.confirmedRange === undefined) {
      logsRequestMetadata.estimatedRange = Math.round(
        logsRequestMetadata.estimatedRange * 1.05,
      );
    }

    return logs;
  };

  const syncTransactionReceipts = async (
    block: SyncBlock,
    transactionHashes: Set<Hash>,
    context?: Parameters<Rpc["request"]>[1],
  ): Promise<SyncTransactionReceipt[]> => {
    if (transactionHashes.size === 0) {
      return [];
    }

    if (isBlockReceipts === false) {
      const transactionReceipts = await Promise.all(
        Array.from(transactionHashes).map(async (hash) => {
          const receipt = await eth_getTransactionReceipt(
            args.rpc,
            [hash],
            context,
          );

          validateReceiptsAndBlock(
            [receipt],
            block,
            {
              method: "eth_getTransactionReceipt",
              params: [hash],
            },
            {
              method: "eth_getBlockByNumber",
              params: [block.number, true],
            },
          );

          return receipt;
        }),
      );

      return transactionReceipts;
    }

    let blockReceipts: SyncTransactionReceipt[];
    try {
      blockReceipts = await eth_getBlockReceipts(
        args.rpc,
        [block.hash],
        context,
      );
    } catch (_error) {
      const error = _error as Error;
      args.common.logger.warn({
        msg: "Caught eth_getBlockReceipts error, switching to eth_getTransactionReceipt method",
        action: "fetch_block_data",
        chain: args.chain.name,
        chain_id: args.chain.id,
        error,
      });

      isBlockReceipts = false;
      return syncTransactionReceipts(block, transactionHashes, context);
    }

    validateReceiptsAndBlock(
      blockReceipts,
      block,
      {
        method: "eth_getBlockReceipts",
        params: [block.hash],
      },
      {
        method: "eth_getBlockByNumber",
        params: [block.number, true],
      },
    );

    const transactionReceipts = blockReceipts.filter((receipt) =>
      transactionHashes.has(receipt.transactionHash),
    );

    return transactionReceipts;
  };

  /**
   * Fetch child addresses for `factory` within `interval`
   *
   * @dev Newly fetched child addresses are added into `args.childAddresses`
   */
  const syncAddressFactory = async (
    factory: Factory,
    interval: Interval,
    context?: Parameters<Rpc["request"]>[1],
  ): Promise<Map<Address, number>> => {
    const logs = await syncLogsDynamic(
      {
        address: factory.address,
        topics: [factory.eventSelector],
        fromBlock: numberToHex(interval[0]),
        toBlock: numberToHex(interval[1]),
      },
      context,
    );

    const childAddresses = new Map<Address, number>();
    const factoryChildAddresses = args.childAddresses.get(factory.id)!;

    const childAddressDecodeFailureIds = new Set<string>();
    let childAddressDecodeFailureCount = 0;
    let childAddressDecodeSuccessCount = 0;

    for (const log of logs) {
      if (isLogFactoryMatched({ factory, log })) {
        let address: Address;
        try {
          address = getChildAddress({ log, factory });
          childAddressDecodeSuccessCount++;
        } catch (error) {
          if (factory.address === undefined) {
            childAddressDecodeFailureCount++;
            if (childAddressDecodeFailureIds.has(factory.id) === false) {
              childAddressDecodeFailureIds.add(factory.id);
              args.common.logger.debug({
                msg: "Failed to extract child address from log matched by factory using the provided ABI item",
                chain: args.chain.name,
                chain_id: args.chain.id,
                factory: factory.sourceId,
                block_number: hexToNumber(log.blockNumber),
                log_index: hexToNumber(log.logIndex),
                data: log.data,
                topics: JSON.stringify(log.topics),
              });
            }
            continue;
          } else {
            throw error;
          }
        }
        const existingBlockNumber = factoryChildAddresses.get(address);
        const newBlockNumber = hexToNumber(log.blockNumber);

        if (
          existingBlockNumber === undefined ||
          existingBlockNumber > newBlockNumber
        ) {
          childAddresses.set(address, newBlockNumber);
          factoryChildAddresses.set(address, newBlockNumber);
        }
      }
    }

    if (childAddressDecodeFailureCount > 0) {
      args.common.logger.debug({
        msg: "Logs matched by factory contained child addresses that could not be extracted",
        failure_count: childAddressDecodeFailureCount,
        success_count: childAddressDecodeSuccessCount,
      });
    }

    return childAddresses;
  };

  return {
    async syncBlockRangeData({
      interval,
      requiredIntervals,
      requiredFactoryIntervals,
      syncStore,
    }) {
      const context = {
        logger: args.common.logger.child({ action: "fetch_block_data" }),
      };
      const endClock = startClock();
      const childAddresses: ChildAddresses = new Map();

      // Dedupe factory intervals by factory id

      const factoryIntervalsById: Map<
        Factory["id"],
        { factory: Factory; interval: Interval }
      > = new Map();

      for (const { factory, interval } of requiredFactoryIntervals) {
        if (factoryIntervalsById.has(factory.id)) {
          const existingInterval = factoryIntervalsById.get(
            factory.id,
          )!.interval;

          factoryIntervalsById.get(factory.id)!.interval = intervalBounds([
            existingInterval,
            interval,
          ]);
        } else {
          factoryIntervalsById.set(factory.id, { factory, interval });
        }
      }

      requiredFactoryIntervals = Array.from(factoryIntervalsById.values());

      await Promise.all(
        requiredFactoryIntervals.map(async ({ factory, interval }) => {
          childAddresses.set(
            factory.id,
            await syncAddressFactory(factory, interval, context)!,
          );
        }),
      );

      const ethGetLogsRequests = mergeLogFiltersToRequests(
        requiredIntervals,
        args.childAddresses,
        args.common.options.factoryAddressCountThreshold,
      );

      let logs: SyncLog[] = [];

      await Promise.all(
        ethGetLogsRequests.map(async (request) => {
          const _logs = await syncLogsDynamic(request.params[0], context);
          for (const log of _logs) {
            logs.push(log);
          }
        }),
      );

      // Remove duplicate logs that may have resulted from intersecting
      // filters.
      logs = dedupe(logs, (log) => `${log.blockNumber}_${log.logIndex}`);

      for (const log of logs) {
        if (log.transactionHash === zeroHash) {
          args.common.logger.warn({
            msg: "Detected log with empty transaction hash. This is expected for some chains like ZKsync.",
            action: "fetch_block_data",
            chain: args.chain.name,
            chain_id: args.chain.id,
            number: hexToNumber(log.blockNumber),
            hash: log.blockHash,
            logIndex: hexToNumber(log.logIndex),
          });
        }
      }

      let childAddressCount = 0;
      for (const { size } of childAddresses.values()) {
        childAddressCount += size;
      }

      args.common.logger.debug(
        {
          msg: "Fetched block range data",
          chain: args.chain.name,
          chain_id: args.chain.id,
          block_range: JSON.stringify(interval),
          log_count: logs.length,
          child_address_count: childAddressCount,
          duration: endClock(),
        },
        ["chain", "block_range"],
      );

      await promiseAllSettledWithThrow(
        Array.from(childAddresses.entries()).map(
          ([factoryId, childAddresses]) =>
            syncStore.insertChildAddresses(
              {
                factory: factoryIntervalsById.get(factoryId)!.factory,
                childAddresses,
                chainId: args.chain.id,
              },
              context,
            ),
        ),
      );

      return logs;
    },
    async syncBlockData({ syncStore, interval, requiredIntervals, logs }) {
      const context = {
        logger: args.common.logger.child({ action: "fetch_block_data" }),
      };
      const endClock = startClock();

      const blockFilters: BlockFilter[] = [];
      const transactionFilters: TransactionFilter[] = [];
      const traceFilters: TraceFilter[] = [];
      const logFilters: LogFilter[] = [];
      const transferFilters: TransferFilter[] = [];

      for (const { filter } of requiredIntervals) {
        switch (filter.type) {
          case "block": {
            blockFilters.push(filter as BlockFilter);
            break;
          }
          case "transaction": {
            transactionFilters.push(filter as TransactionFilter);
            break;
          }
          case "trace": {
            traceFilters.push(filter as TraceFilter);
            break;
          }
          case "log": {
            logFilters.push(filter as LogFilter);
            break;
          }
          case "transfer": {
            transferFilters.push(filter as TransferFilter);
            break;
          }
        }
      }

      const perBlockLogs = new Map<number, SyncLog[]>();
      for (const log of logs) {
        const blockNumber = hexToNumber(log.blockNumber);
        if (perBlockLogs.has(blockNumber) === false) {
          perBlockLogs.set(blockNumber, []);
        }
        perBlockLogs.get(blockNumber)!.push(log);
      }

      let closestToTipBlock: SyncBlock | undefined;

      const syncBlockData = async (blockNumber: number) => {
        let block: SyncBlock | undefined;

        const requiredTransactions = new Set<Hash>();
        const requiredTransactionReceipts = new Set<Hash>();

        ////////
        // Logs
        ////////

        let logs: SyncLog[] = [];
        if (perBlockLogs.has(blockNumber)) {
          block = await eth_getBlockByNumber(
            args.rpc,
            [numberToHex(blockNumber), true],
            context,
          );

          logs = perBlockLogs.get(blockNumber)!.filter((log) => {
            let isMatched = false;

            for (const filter of logFilters) {
              if (
                isLogFilterMatched({ filter, log }) &&
                (isAddressFactory(filter.address)
                  ? isAddressMatched({
                      address: log.address,
                      blockNumber,
                      childAddresses: args.childAddresses.get(
                        filter.address.id,
                      )!,
                    })
                  : true)
              ) {
                isMatched = true;

                if (log.transactionHash !== zeroHash) {
                  requiredTransactions.add(log.transactionHash);
                  if (filter.hasTransactionReceipt) {
                    requiredTransactionReceipts.add(log.transactionHash);

                    // skip to next log
                    break;
                  }
                }
              }
            }

            return isMatched;
          });

          if (logs.length > 0) {
            // Note: `logsRequest` could be more accurate by tracking the exact
            // request made to include `address` and `topics`.
            validateLogsAndBlock(
              logs,
              block,
              {
                method: "eth_getLogs",
                params: [
                  {
                    fromBlock: toHex(blockNumber),
                    toBlock: toHex(blockNumber),
                  },
                ],
              },
              {
                method: "eth_getBlockByNumber",
                params: [toHex(blockNumber), true],
              },
            );
          }
        }

        ////////
        // Traces
        ////////

        const shouldRequestTraces =
          traceFilters.some((filter) => isBlockInFilter(filter, blockNumber)) ||
          transferFilters.some((filter) =>
            isBlockInFilter(filter, blockNumber),
          );

        let traces: SyncTrace[] = [];
        if (shouldRequestTraces) {
          if (block === undefined) {
            [block, traces] = await Promise.all([
              eth_getBlockByNumber(
                args.rpc,
                [numberToHex(blockNumber), true],
                context,
              ),
              debug_traceBlockByNumber(
                args.rpc,
                [numberToHex(blockNumber), { tracer: "callTracer" }],
                context,
              ),
            ]);
          } else {
            traces = await debug_traceBlockByNumber(
              args.rpc,
              [numberToHex(blockNumber), { tracer: "callTracer" }],
              context,
            );
          }

          traces = traces.filter((trace) => {
            let isMatched = false;
            for (const filter of transferFilters) {
              if (
                isTransferFilterMatched({
                  filter,
                  trace: trace.trace,
                  block: { number: BigInt(blockNumber) },
                }) &&
                (isAddressFactory(filter.fromAddress)
                  ? isAddressMatched({
                      address: trace.trace.from,
                      blockNumber,
                      childAddresses: args.childAddresses.get(
                        filter.fromAddress.id,
                      )!,
                    })
                  : true) &&
                (isAddressFactory(filter.toAddress)
                  ? isAddressMatched({
                      address: trace.trace.to,
                      blockNumber,
                      childAddresses: args.childAddresses.get(
                        filter.toAddress.id,
                      )!,
                    })
                  : true)
              ) {
                isMatched = true;
                requiredTransactions.add(trace.transactionHash);
                if (filter.hasTransactionReceipt) {
                  requiredTransactionReceipts.add(trace.transactionHash);
                  // skip to next trace
                  break;
                }
              }
            }

            for (const filter of traceFilters) {
              if (
                isTraceFilterMatched({
                  filter,
                  trace: trace.trace,
                  block: { number: BigInt(blockNumber) },
                }) &&
                (isAddressFactory(filter.fromAddress)
                  ? isAddressMatched({
                      address: trace.trace.from,
                      blockNumber,
                      childAddresses: args.childAddresses.get(
                        filter.fromAddress.id,
                      )!,
                    })
                  : true) &&
                (isAddressFactory(filter.toAddress)
                  ? isAddressMatched({
                      address: trace.trace.to,
                      blockNumber,
                      childAddresses: args.childAddresses.get(
                        filter.toAddress.id,
                      )!,
                    })
                  : true)
              ) {
                isMatched = true;
                requiredTransactions.add(trace.transactionHash);
                if (filter.hasTransactionReceipt) {
                  requiredTransactionReceipts.add(trace.transactionHash);
                  // skip to next trace
                  break;
                }
              }
            }

            return isMatched;
          });

          if (traces.length > 0) {
            validateTracesAndBlock(
              traces,
              block,
              {
                method: "debug_traceBlockByNumber",
                params: [toHex(blockNumber), { tracer: "callTracer" }],
              },
              {
                method: "eth_getBlockByNumber",
                params: [toHex(blockNumber), true],
              },
            );
          }
        }

        ////////
        // Block
        ////////

        if (
          block === undefined &&
          blockFilters.some((filter) =>
            isBlockFilterMatched({
              filter,
              block: { number: BigInt(blockNumber) },
            }),
          )
        ) {
          block = await eth_getBlockByNumber(
            args.rpc,
            [numberToHex(blockNumber), true],
            context,
          );
        }

        ////////
        // Transactions
        ////////

        // Return early if no data is fetched
        if (
          block === undefined &&
          transactionFilters.some((filter) =>
            isBlockInFilter(filter, blockNumber),
          ) === false
        ) {
          return;
        }

        if (block === undefined) {
          block = await eth_getBlockByNumber(
            args.rpc,
            [numberToHex(blockNumber), true],
            context,
          );
        }

        if (
          closestToTipBlock === undefined ||
          hexToNumber(block.number) > hexToNumber(closestToTipBlock.number)
        ) {
          closestToTipBlock = block;
        }

        const transactions = block.transactions.filter((transaction) => {
          let isMatched = requiredTransactions.has(transaction.hash);
          for (const filter of transactionFilters) {
            if (
              isTransactionFilterMatched({ filter, transaction }) &&
              (isAddressFactory(filter.fromAddress)
                ? isAddressMatched({
                    address: transaction.from,
                    blockNumber,
                    childAddresses: args.childAddresses.get(
                      filter.fromAddress.id,
                    )!,
                  })
                : true) &&
              (isAddressFactory(filter.toAddress)
                ? isAddressMatched({
                    address: transaction.to ?? undefined,
                    blockNumber,
                    childAddresses: args.childAddresses.get(
                      filter.toAddress.id,
                    )!,
                  })
                : true)
            ) {
              requiredTransactionReceipts.add(transaction.hash);
              isMatched = true;
            }
          }
          return isMatched;
        });

        if (transactions.length > 0) {
          validateTransactionsAndBlock(block, {
            method: "eth_getBlockByNumber",
            params: [toHex(blockNumber), true],
          });
        }

        const transactionsByHash = new Map<Hash, SyncTransaction>();
        for (const transaction of transactions) {
          transactionsByHash.set(transaction.hash, transaction);
        }

        ////////
        // Transaction Receipts
        ////////

        const transactionReceipts = await syncTransactionReceipts(
          block,
          requiredTransactionReceipts,
        );

        blockCount += 1;
        transactionCount += transactions.length;
        receiptCount += transactionReceipts.length;
        traceCount += traces.length;

        // Free memory of all unused transactions
        block.transactions = transactions;

        await promiseAllSettledWithThrow([
          syncStore.insertBlocks({ blocks: [block], chainId: args.chain.id }),
          syncStore.insertTransactions({
            transactions,
            chainId: args.chain.id,
          }),
          syncStore.insertTransactionReceipts({
            transactionReceipts,
            chainId: args.chain.id,
          }),
          syncStore.insertTraces({
            traces: traces.map((trace) => ({
              trace,
              block: block!,
              transaction: transactionsByHash.get(trace.transactionHash)!,
            })),
            chainId: args.chain.id,
          }),
          syncStore.insertLogs({ logs, chainId: args.chain.id }),
        ]);
      };

      let blockCount = 0;
      let transactionCount = 0;
      let receiptCount = 0;
      let traceCount = 0;

      // Same memory usage as `sync-realtime`.
      const MAX_BLOCKS_IN_MEM = Math.max(
        args.chain.finalityBlockCount * 2,
        100,
      );

      if (requiredIntervals.length > 0) {
        const queue = createQueue({
          browser: false,
          initialStart: true,
          concurrency: MAX_BLOCKS_IN_MEM,
          worker: syncBlockData,
        });

        await Promise.all(
          intervalRange(interval).map((blockNumber) => queue.add(blockNumber)),
        );
      }

      args.common.logger.debug(
        {
          msg: "Fetched block data",
          chain: args.chain.name,
          chain_id: args.chain.id,
          block_range: JSON.stringify(interval),
          block_count: blockCount,
          transaction_count: transactionCount,
          receipt_count: receiptCount,
          trace_count: traceCount,
          duration: endClock(),
        },
        ["chain", "block_range"],
      );

      return closestToTipBlock;
    },
  };
};
