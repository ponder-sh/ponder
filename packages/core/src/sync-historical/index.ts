import type { Common } from "@/common/common.js";
import type { Network } from "@/config/networks.js";
import {
  isTraceFilterMatched,
  isTransactionFilterMatched,
  isTransferFilterMatched,
} from "@/sync-realtime/filter.js";
import type { SyncStore } from "@/sync-store/index.js";
import { type Fragment, recoverFilter } from "@/sync/fragments.js";
import {
  type BlockFilter,
  type Factory,
  type Filter,
  type FilterWithoutBlocks,
  type LogFactory,
  type LogFilter,
  type TraceFilter,
  type TransferFilter,
  isAddressFactory,
  shouldGetTransactionReceipt,
} from "@/sync/source.js";
import type { Source, TransactionFilter } from "@/sync/source.js";
import type {
  SyncBlock,
  SyncLog,
  SyncTransactionReceipt,
} from "@/types/sync.js";
import {
  type Interval,
  getChunks,
  intervalBounds,
  intervalDifference,
  intervalRange,
} from "@/utils/interval.js";
import type { RequestQueue } from "@/utils/requestQueue.js";
import {
  _debug_traceBlockByHash,
  _debug_traceBlockByNumber,
  _eth_getBlockByNumber,
  _eth_getBlockReceipts,
  _eth_getLogs,
  _eth_getTransactionReceipt,
} from "@/utils/rpc.js";
import { getLogsRetryHelper } from "@ponder/utils";
import {
  type Address,
  type Hash,
  type RpcError,
  hexToBigInt,
  hexToNumber,
  toHex,
  zeroHash,
} from "viem";

export type HistoricalSync = {
  intervalsCache: Map<Filter, { fragment: Fragment; intervals: Interval[] }[]>;
  /**
   * Extract raw data for `interval` and return the closest-to-tip block
   * that is synced.
   */
  sync(interval: Interval): Promise<SyncBlock | undefined>;
  kill(): void;
};

type CreateHistoricalSyncParameters = {
  common: Common;
  sources: Source[];
  syncStore: SyncStore;
  network: Network;
  requestQueue: RequestQueue;
  onFatalError: (error: Error) => void;
};

export const createHistoricalSync = async (
  args: CreateHistoricalSyncParameters,
): Promise<HistoricalSync> => {
  let isKilled = false;
  /**
   * Flag to fetch transaction receipts through _eth_getBlockReceipts (true) or _eth_getTransactionReceipt (false)
   */
  let isBlockReceipts = true;

  /**
   * Data about the range passed to "eth_getLogs" for all log
   *  filters and log factories.
   */
  const getLogsRequestMetadata = new Map<
    LogFilter | LogFactory,
    {
      /** Estimate optimal range to use for "eth_getLogs" requests */
      estimatedRange: number;
      /** Range suggested by an error message */
      confirmedRange?: number;
    }
  >();
  /**
   * Intervals that have been completed for all filters in `args.sources`.
   *
   * Note: `intervalsCache` is not updated after a new interval is synced.
   */
  let intervalsCache: Map<
    Filter,
    { fragment: Fragment; intervals: Interval[] }[]
  >;
  if (args.network.disableCache) {
    intervalsCache = new Map();
    for (const { filter } of args.sources) {
      intervalsCache.set(filter, []);
    }
  } else {
    intervalsCache = await args.syncStore.getIntervals({
      filters: args.sources.map(({ filter }) => filter),
    });
  }

  // Closest-to-tip block that has been synced.
  let latestBlock: SyncBlock | undefined;

  ////////
  // Helper functions for sync tasks
  ////////

  /**
   * Split "eth_getLogs" requests into ranges inferred from errors
   * and batch requests.
   */
  const syncLogsDynamic = async ({
    filter,
    address,
    interval,
  }: {
    filter: LogFilter | LogFactory;
    interval: Interval;
    /** Explicitly set because of the complexity of factory contracts. */
    address: Address | Address[] | undefined;
  }): Promise<SyncLog[]> => {
    //  Use the recommended range if available, else don't chunk the interval at all.

    const metadata = getLogsRequestMetadata.get(filter);
    const intervals = metadata
      ? getChunks({
          interval,
          maxChunkSize: metadata.confirmedRange ?? metadata.estimatedRange,
        })
      : [interval];

    const topics =
      "eventSelector" in filter
        ? [filter.eventSelector]
        : [
            filter.topic0 ?? null,
            filter.topic1 ?? null,
            filter.topic2 ?? null,
            filter.topic3 ?? null,
          ];

    // Note: the `topics` field is very fragile for many rpc providers, and
    // cannot handle extra "null" topics

    if (topics[3] === null) {
      topics.pop();
      if (topics[2] === null) {
        topics.pop();
        if (topics[1] === null) {
          topics.pop();
          if (topics[0] === null) {
            topics.pop();
          }
        }
      }
    }

    // Batch large arrays of addresses, handling arrays that are empty

    let addressBatches: (Address | Address[] | undefined)[];

    if (address === undefined) {
      // no address (match all)
      addressBatches = [undefined];
    } else if (typeof address === "string") {
      // single address
      addressBatches = [address];
    } else if (address.length === 0) {
      // no address (factory with no children)
      return [];
    } else {
      // many addresses
      // Note: it is assumed that `address` is deduplicated
      addressBatches = [];
      for (let i = 0; i < address.length; i += 50) {
        addressBatches.push(address.slice(i, i + 50));
      }
    }

    const logs = await Promise.all(
      intervals.flatMap((interval) =>
        addressBatches.map((address) =>
          _eth_getLogs(args.requestQueue, {
            address,
            topics,
            fromBlock: interval[0],
            toBlock: interval[1],
          }).catch((error) => {
            const getLogsErrorResponse = getLogsRetryHelper({
              params: [
                {
                  address,
                  topics,
                  fromBlock: toHex(interval[0]),
                  toBlock: toHex(interval[1]),
                },
              ],
              error: error as RpcError,
            });

            if (getLogsErrorResponse.shouldRetry === false) throw error;

            const range =
              hexToNumber(getLogsErrorResponse.ranges[0]!.toBlock) -
              hexToNumber(getLogsErrorResponse.ranges[0]!.fromBlock);

            args.common.logger.debug({
              service: "sync",
              msg: `Caught eth_getLogs error on '${
                args.network.name
              }', updating recommended range to ${range}.`,
            });

            getLogsRequestMetadata.set(filter, {
              estimatedRange: range,
              confirmedRange: getLogsErrorResponse.isSuggestedRange
                ? range
                : undefined,
            });

            return syncLogsDynamic({ address, interval, filter });
          }),
        ),
      ),
    ).then((logs) => logs.flat());

    const logIds = new Set<string>();
    for (const log of logs) {
      const id = `${log.blockHash}-${log.logIndex}`;
      if (logIds.has(id)) {
        args.common.logger.warn({
          service: "sync",
          msg: `Detected invalid eth_getLogs response. Duplicate log for block ${log.blockHash} with index ${log.logIndex}.`,
        });
      } else {
        logIds.add(id);
      }
    }

    /**
     * Dynamically increase the range used in "eth_getLogs" if an
     * error has been received but the error didn't suggest a range.
     */

    if (
      getLogsRequestMetadata.has(filter) &&
      getLogsRequestMetadata.get(filter)!.confirmedRange === undefined
    ) {
      getLogsRequestMetadata.get(filter)!.estimatedRange = Math.round(
        getLogsRequestMetadata.get(filter)!.estimatedRange * 1.05,
      );
    }

    return logs;
  };

  const getTransactionReceipts = async (
    block: Hash,
    transactionHashes: Set<Hash>,
  ): Promise<SyncTransactionReceipt[]> => {
    if (transactionHashes.size === 0) {
      return [];
    }

    if (isBlockReceipts === false) {
      const transactionReceipts = await Promise.all(
        Array.from(transactionHashes).map((hash) =>
          _eth_getTransactionReceipt(args.requestQueue, { hash }),
        ),
      );

      return transactionReceipts;
    }

    let blockReceipts: SyncTransactionReceipt[];
    try {
      blockReceipts = await _eth_getBlockReceipts(args.requestQueue, {
        blockHash: block,
      });
    } catch (_error) {
      const error = _error as Error;
      args.common.logger.warn({
        service: "sync",
        msg: `Caught eth_getBlockReceipts error on '${
          args.network.name
        }', switching to eth_getTransactionReceipt method.`,
        error,
      });

      isBlockReceipts = false;
      return getTransactionReceipts(block, transactionHashes);
    }

    const blockReceiptsTransactionHashes = new Set(
      blockReceipts.map((r) => r.transactionHash),
    );
    // Validate that block transaction receipts include all required transactions
    for (const hash of Array.from(transactionHashes)) {
      if (blockReceiptsTransactionHashes.has(hash) === false) {
        throw new Error(
          `Detected inconsistent RPC responses. 'transaction.hash' ${hash} not found in eth_getBlockReceipts response for block '${block}'`,
        );
      }
    }
    const transactionReceipts = blockReceipts.filter((receipt) =>
      transactionHashes.has(receipt.transactionHash),
    );

    return transactionReceipts;
  };

  /** Extract and insert the log-based addresses that match `filter` + `interval`. */
  const syncLogFactory = async (filter: LogFactory, interval: Interval) => {
    const logs = await syncLogsDynamic({
      filter,
      interval,
      address: filter.address,
    });

    if (isKilled) return;

    // Insert `logs` into the sync-store
    await args.syncStore.insertLogs({
      logs: logs.map((log) => ({ log })),
      shouldUpdateCheckpoint: false,
      chainId: args.network.chainId,
    });
  };

  /**
   * Return all addresses that match `filter` after extracting addresses
   * that match `filter` and `interval`. Returns `undefined` if the number of
   * child addresses is above the limit.
   */
  const syncAddressFactory = async (
    filter: Factory,
    interval: Interval,
  ): Promise<Address[] | undefined> => {
    await syncLogFactory(filter, interval);

    // Query the sync-store for all addresses that match `filter`.
    const addresses = await args.syncStore.getChildAddresses({
      filter,
      limit: args.common.options.factoryAddressCountThreshold,
    });

    if (addresses.length === args.common.options.factoryAddressCountThreshold) {
      return undefined;
    }

    return addresses;
  };

  ////////
  // Helper function for filter types
  ////////

  const resolveChildAddresses = async (
    filter: TransactionFilter | TraceFilter | TransferFilter,
    interval: Interval,
  ) => {
    const fromChildAddresses = isAddressFactory(filter.fromAddress)
      ? await syncAddressFactory(filter.fromAddress, interval).then(
          (addresses) =>
            addresses === undefined ? undefined : new Set(addresses),
        )
      : undefined;

    const toChildAddresses = isAddressFactory(filter.toAddress)
      ? await syncAddressFactory(filter.toAddress, interval).then(
          (addresses) =>
            addresses === undefined ? undefined : new Set(addresses),
        )
      : undefined;

    return { fromChildAddresses, toChildAddresses };
  };

  const resolveLogFilter = async (filter: LogFilter, interval: Interval) => {
    // Resolve `filter.address`
    const address = isAddressFactory(filter.address)
      ? await syncAddressFactory(filter.address, interval)
      : filter.address;

    const logs = await syncLogsDynamic({ filter, interval, address });

    return logs;
  };

  const resolveBlockFilter = (filter: BlockFilter, interval: Interval) => {
    const baseOffset = (interval[0] - filter.offset) % filter.interval;
    const offset = baseOffset === 0 ? 0 : filter.interval - baseOffset;

    // Determine which blocks are matched by the block filter.
    const requiredBlocks: number[] = [];
    for (let b = interval[0] + offset; b <= interval[1]; b += filter.interval) {
      requiredBlocks.push(b);
    }

    return requiredBlocks;
  };

  return {
    intervalsCache,
    async sync(_interval) {
      const intervalsToSync: {
        interval: Interval;
        filter: FilterWithoutBlocks;
      }[] = [];

      // Determine the requests that need to be made, and which intervals need to be inserted.
      // Fragments are used to create a minimal filter, to avoid refetching data even if a filter
      // is only partially synced.

      for (const { filter } of args.sources) {
        if (
          (filter.fromBlock !== undefined && filter.fromBlock > _interval[1]) ||
          (filter.toBlock !== undefined && filter.toBlock < _interval[0])
        ) {
          continue;
        }

        const interval: Interval = [
          Math.max(filter.fromBlock ?? 0, _interval[0]),
          Math.min(filter.toBlock ?? Number.POSITIVE_INFINITY, _interval[1]),
        ];

        const completedIntervals = intervalsCache.get(filter)!;
        const requiredIntervals: {
          fragment: Fragment;
          intervals: Interval[];
        }[] = [];

        for (const {
          fragment,
          intervals: fragmentIntervals,
        } of completedIntervals) {
          const requiredFragmentIntervals = intervalDifference(
            [interval],
            fragmentIntervals,
          );

          if (requiredFragmentIntervals.length > 0) {
            requiredIntervals.push({
              fragment,
              intervals: requiredFragmentIntervals,
            });
          }
        }

        if (requiredIntervals.length > 0) {
          const requiredInterval = intervalBounds(
            requiredIntervals.flatMap(({ intervals }) => intervals),
          );

          const requiredFilter = recoverFilter(
            filter,
            requiredIntervals.map(({ fragment }) => fragment),
          );

          intervalsToSync.push({
            filter: requiredFilter,
            interval: requiredInterval,
          });
        }
      }

      if (isKilled) return;

      // Collect the blockNumbers to sync
      const blocksToSync: Set<number> = new Set();
      const resolvedLogIntervals: {
        interval: Interval;
        filter: Omit<LogFilter, "fromBlock" | "toBlock">;
        logs: SyncLog[];
      }[] = [];

      const resolvedChildAddressIntervals: {
        interval: Interval;
        filter: Omit<
          TraceFilter | TransactionFilter | TransferFilter,
          "fromBlock" | "toBlock"
        >;
        fromChildAddresses: Set<Address> | undefined;
        toChildAddresses: Set<Address> | undefined;
      }[] = [];

      await Promise.all(
        intervalsToSync.map(async ({ filter, interval }) => {
          switch (filter.type) {
            case "log": {
              const logs = await resolveLogFilter(
                filter as LogFilter,
                interval,
              );

              for (const { blockNumber } of logs) {
                blocksToSync.add(hexToNumber(blockNumber));
              }

              resolvedLogIntervals.push({
                filter,
                interval,
                logs: await resolveLogFilter(filter as LogFilter, interval),
              });

              break;
            }
            case "trace":
            case "transaction":
            case "transfer": {
              for (const blockNumber of intervalRange(interval)) {
                blocksToSync.add(blockNumber);
              }

              resolvedChildAddressIntervals.push({
                filter,
                interval,
                ...(await resolveChildAddresses(
                  filter as TransactionFilter | TraceFilter | TransferFilter,
                  interval,
                )),
              });
              break;
            }
            case "block": {
              const requiredBlocks = resolveBlockFilter(
                filter as BlockFilter,
                interval,
              );

              for (const blockNumber of requiredBlocks) {
                blocksToSync.add(blockNumber);
              }

              break;
            }
          }
        }),
      );

      await Promise.all(
        [...blocksToSync].map(async (number) => {
          try {
            const block = await _eth_getBlockByNumber(args.requestQueue, {
              blockNumber: number,
            });

            if (isKilled) return;

            // Update the latest block if necessary
            if (
              hexToBigInt(block.number) >=
              hexToBigInt(latestBlock?.number ?? "0x0")
            ) {
              latestBlock = block;
            }

            const requiredTransactions = new Set<Hash>();
            const requiredTransactionReceipts = new Set<Hash>();

            const blockLogs = resolvedLogIntervals.flatMap(
              ({ filter, interval, logs }) => {
                if (interval[1] < number || interval[0] > number) return [];

                const filteredLogs: SyncLog[] = [];

                let j = 0;
                logs.forEach((log, i) => {
                  if (log.blockNumber !== toHex(number)) {
                    if (i !== j) logs[j] = log;
                    j++;

                    return;
                  }

                  if (block.hash !== log.blockHash) {
                    throw new Error(
                      `Detected inconsistent RPC responses. 'log.blockHash' ${log.blockHash} does not match 'block.hash' ${block.hash}`,
                    );
                  }

                  if (
                    block.transactions.find(
                      (t) => t.hash === log.transactionHash,
                    ) === undefined
                  ) {
                    if (log.transactionHash === zeroHash) {
                      args.common.logger.warn({
                        service: "sync",
                        msg: `Detected log with empty transaction hash in block ${block.hash} at log index ${hexToNumber(log.logIndex)}. This is expected for some networks like ZKsync.`,
                      });
                    } else {
                      throw new Error(
                        `Detected inconsistent RPC responses. 'log.transactionHash' ${log.transactionHash} not found in 'block.transactions' ${block.hash}`,
                      );
                    }
                  }

                  requiredTransactions.add(log.transactionHash);

                  if (shouldGetTransactionReceipt(filter)) {
                    if (log.transactionHash === zeroHash) {
                      args.common.logger.warn({
                        service: "sync",
                        msg: `Detected log with empty transaction hash in block ${log.blockHash} at log index ${hexToNumber(log.logIndex)}. This is expected for some networks like ZKsync.`,
                      });
                    } else {
                      requiredTransactionReceipts.add(log.transactionHash);
                    }
                  }

                  filteredLogs.push(log);
                });
                logs.length = j;

                return filteredLogs;
              },
            );

            if (isKilled) return;

            await args.syncStore.insertLogs({
              logs: blockLogs.map((log) => ({ log, block })),
              shouldUpdateCheckpoint: true,
              chainId: args.network.chainId,
            });

            if (isKilled) return;

            const requiredChildAddressIntervals =
              resolvedChildAddressIntervals.filter(
                ({ interval }) =>
                  interval[0] <= number && interval[1] >= number,
              );

            const traceIntervals = requiredChildAddressIntervals.filter(
              ({ filter }) => filter.type === "trace",
            );
            const transferIntervals = requiredChildAddressIntervals.filter(
              ({ filter }) => filter.type === "transfer",
            );

            if (traceIntervals.length > 0 || transferIntervals.length > 0) {
              const traces = await _debug_traceBlockByHash(args.requestQueue, {
                hash: block.hash,
              });

              if (isKilled) return;

              const requiredTraces = traces
                .filter((trace) => {
                  let isMatched = false;

                  for (const {
                    filter,
                    fromChildAddresses,
                    toChildAddresses,
                  } of traceIntervals) {
                    if (
                      isTraceFilterMatched({
                        filter: filter as TraceFilter,
                        block,
                        trace: trace.trace,
                        fromChildAddresses,
                        toChildAddresses,
                      })
                    ) {
                      isMatched = true;
                      if (shouldGetTransactionReceipt(filter)) {
                        requiredTransactionReceipts.add(trace.transactionHash);
                        return true;
                      }
                    }
                  }

                  for (const {
                    filter,
                    fromChildAddresses,
                    toChildAddresses,
                  } of transferIntervals) {
                    if (
                      isTransferFilterMatched({
                        filter: filter as TransferFilter,
                        block,
                        trace: trace.trace,
                        fromChildAddresses,
                        toChildAddresses,
                      })
                    ) {
                      isMatched = true;
                      if (shouldGetTransactionReceipt(filter)) {
                        requiredTransactionReceipts.add(trace.transactionHash);
                        return true;
                      }
                    }
                  }

                  return isMatched;
                })
                .map((trace) => {
                  const transaction = block.transactions.find(
                    (t) => t.hash === trace.transactionHash,
                  );

                  if (transaction === undefined) {
                    throw new Error(
                      `Detected inconsistent RPC responses. 'trace.transactionHash' ${trace.transactionHash} not found in 'block.transactions' ${block.hash}`,
                    );
                  }

                  requiredTransactions.add(transaction.hash);

                  return { trace, transaction, block };
                });

              if (isKilled) return;

              await args.syncStore.insertTraces({
                traces: requiredTraces,
                chainId: args.network.chainId,
              });
            }

            const transactionIntervals = requiredChildAddressIntervals.filter(
              ({ filter }) => filter.type === "transaction",
            );

            if (transactionIntervals.length > 0) {
              block.transactions.map((transaction) => {
                if (
                  requiredTransactions.has(transaction.hash) &&
                  requiredTransactionReceipts.has(transaction.hash)
                )
                  return;

                if (
                  transactionIntervals.some(
                    ({ filter, fromChildAddresses, toChildAddresses }) =>
                      isTransactionFilterMatched({
                        filter: filter as TransactionFilter,
                        block,
                        transaction,
                        fromChildAddresses,
                        toChildAddresses,
                      }),
                  )
                ) {
                  requiredTransactions.add(transaction.hash);
                  requiredTransactionReceipts.add(transaction.hash);
                }
              });
            }

            if (isKilled) return;

            const transactionReceipts = await getTransactionReceipts(
              block.hash,
              requiredTransactionReceipts,
            );

            if (isKilled) return;

            // Insert the block, required transactions and transaction receipts into syncStore
            await Promise.all([
              args.syncStore.insertBlocks({
                blocks: [block],
                chainId: args.network.chainId,
              }),
              args.syncStore.insertTransactions({
                transactions: block.transactions
                  .filter(({ hash }) => requiredTransactions.has(hash))
                  .map((transaction) => ({
                    transaction,
                    block,
                  })),
                chainId: args.network.chainId,
              }),
              args.syncStore.insertTransactionReceipts({
                transactionReceipts,
                chainId: args.network.chainId,
              }),
            ]);
          } catch (_error) {
            const error = _error as Error;

            args.common.logger.error({
              service: "sync",
              msg: `Fatal error: Unable to sync '${args.network.name}' for ${number} block.`,
              error,
            });

            args.onFatalError(error);

            return;
          }
        }),
      );

      // Add corresponding intervals to the sync-store
      // Note: this should happen after so the database doesn't become corrupted
      if (args.network.disableCache === false) {
        await args.syncStore.insertIntervals({
          intervals: intervalsToSync,
          chainId: args.network.chainId,
        });
      }

      return latestBlock;
    },
    kill() {
      isKilled = true;
    },
  };
};
