import type { Common } from "@/internal/common.js";
import type {
  BlockFilter,
  Factory,
  Filter,
  FilterWithoutBlocks,
  Fragment,
  LogFactory,
  LogFilter,
  Network,
  Source,
  TraceFilter,
  TransactionFilter,
  TransferFilter,
} from "@/internal/types.js";
import type { SyncStore } from "@/sync-store/index.js";
import {
  isAddressFactory,
  isTraceFilterMatched,
  isTransactionFilterMatched,
  isTransferFilterMatched,
} from "@/sync/filter.js";
import { shouldGetTransactionReceipt } from "@/sync/filter.js";
import { recoverFilter } from "@/sync/fragments.js";
import type {
  SyncBlock,
  SyncLog,
  SyncTrace,
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
  /**
   * Flag to fetch transaction receipts through _eth_getBlockReceipts (true) or _eth_getTransactionReceipt (false)
   */
  let isBlockReceipts = true;
  /**
   * Blocks that have already been extracted.
   * Note: All entries are deleted at the end of each call to `sync()`.
   */
  const blockCache = new Map<number, Promise<SyncBlock>>();
  /**
   * Traces that have already been fetched.
   * Note: All entries are deleted at the end of each call to `sync()`.
   */
  const traceCache = new Map<number, Promise<SyncTrace[]>>();
  /**
   * Transactions that should be saved to the sync-store.
   * Note: All entries are deleted at the end of each call to `sync()`.
   */
  const transactionsCache = new Set<Hash>();
  /**
   * Block transaction receipts that have already been fetched.
   * Note: All entries are deleted at the end of each call to `sync()`.
   */
  const blockReceiptsCache = new Map<Hash, Promise<SyncTransactionReceipt[]>>();
  /**
   * Transaction receipts that have already been fetched.
   * Note: All entries are deleted at the end of each call to `sync()`.
   */
  const transactionReceiptsCache = new Map<
    Hash,
    Promise<SyncTransactionReceipt>
  >();

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
          msg: `Detected invalid eth_getLogs response. Duplicate log index ${log.logIndex} for block ${log.blockHash}.`,
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

  /**
   * Extract block, using `blockCache` to avoid fetching
   * the same block twice. Also, update `latestBlock`.
   *
   * @param number Block to be extracted
   *
   * Note: This function could more accurately skip network requests by taking
   * advantage of `syncStore.hasBlock` and `syncStore.hasTransaction`.
   */
  const syncBlock = async (number: number): Promise<SyncBlock> => {
    let block: SyncBlock;

    /**
     * `blockCache` contains all blocks that have been extracted during the
     * current call to `sync()`. If `number` is present in `blockCache` use it,
     * otherwise, request the block and add it to `blockCache` and the sync-store.
     */

    if (blockCache.has(number)) {
      block = await blockCache.get(number)!;
    } else {
      const _block = _eth_getBlockByNumber(args.requestQueue, {
        blockNumber: toHex(number),
      });
      blockCache.set(number, _block);
      block = await _block;

      // Update `latestBlock` if `block` is closer to tip.
      if (
        hexToBigInt(block.number) >= hexToBigInt(latestBlock?.number ?? "0x0")
      ) {
        latestBlock = block;
      }
    }

    return block;
  };

  const syncTrace = async (block: number) => {
    if (traceCache.has(block)) {
      return await traceCache.get(block)!;
    } else {
      const traces = _debug_traceBlockByNumber(args.requestQueue, {
        blockNumber: block,
      });
      traceCache.set(block, traces);
      return await traces;
    }
  };

  const syncTransactionReceipts = async (
    block: Hash,
    transactionHashes: Set<Hash>,
  ): Promise<SyncTransactionReceipt[]> => {
    if (transactionHashes.size === 0) {
      return [];
    }

    if (isBlockReceipts === false) {
      const transactionReceipts = await Promise.all(
        Array.from(transactionHashes).map((hash) =>
          syncTransactionReceipt(hash),
        ),
      );

      return transactionReceipts;
    }

    let blockReceipts: SyncTransactionReceipt[];
    try {
      blockReceipts = await syncBlockReceipts(block);
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
      return syncTransactionReceipts(block, transactionHashes);
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

  const syncTransactionReceipt = async (transaction: Hash) => {
    if (transactionReceiptsCache.has(transaction)) {
      return await transactionReceiptsCache.get(transaction)!;
    } else {
      const receipt = _eth_getTransactionReceipt(args.requestQueue, {
        hash: transaction,
      });
      transactionReceiptsCache.set(transaction, receipt);
      return await receipt;
    }
  };

  const syncBlockReceipts = async (block: Hash) => {
    if (blockReceiptsCache.has(block)) {
      return await blockReceiptsCache.get(block)!;
    } else {
      const blockReceipts = _eth_getBlockReceipts(args.requestQueue, {
        blockHash: block,
      });
      blockReceiptsCache.set(block, blockReceipts);
      return await blockReceipts;
    }
  };

  /** Extract and insert the log-based addresses that match `filter` + `interval`. */
  const syncLogFactory = async (filter: LogFactory, interval: Interval) => {
    const logs = await syncLogsDynamic({
      filter,
      interval,
      address: filter.address,
    });

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

  const syncLogFilter = async (filter: LogFilter, interval: Interval) => {
    // Resolve `filter.address`
    const address = isAddressFactory(filter.address)
      ? await syncAddressFactory(filter.address, interval)
      : filter.address;

    const logs = await syncLogsDynamic({ filter, interval, address });

    const blocks = await Promise.all(
      logs.map((log) => syncBlock(hexToNumber(log.blockNumber))),
    );

    const requiredBlocks = new Set(blocks.map((b) => b.hash));

    // Validate that logs point to the valid transaction hash in the block
    for (let i = 0; i < logs.length; i++) {
      const log = logs[i]!;
      const block = blocks[i]!;

      if (block.hash !== log.blockHash) {
        throw new Error(
          `Detected inconsistent RPC responses. 'log.blockHash' ${log.blockHash} does not match 'block.hash' ${block.hash}`,
        );
      }

      if (
        block.transactions.find((t) => t.hash === log.transactionHash) ===
        undefined
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
    }

    const transactionHashes = new Set(logs.map((l) => l.transactionHash));
    for (const hash of transactionHashes) {
      transactionsCache.add(hash);
    }

    await args.syncStore.insertLogs({
      logs: logs.map((log, i) => ({ log, block: blocks[i]! })),
      shouldUpdateCheckpoint: true,
      chainId: args.network.chainId,
    });

    if (shouldGetTransactionReceipt(filter)) {
      const transactionReceipts = await Promise.all(
        Array.from(requiredBlocks).map((blockHash) => {
          const blockTransactionHashes = new Set<Hash>();

          for (const log of logs) {
            if (log.blockHash === blockHash) {
              if (log.transactionHash === zeroHash) {
                args.common.logger.warn({
                  service: "sync",
                  msg: `Detected log with empty transaction hash in block ${log.blockHash} at log index ${hexToNumber(log.logIndex)}. This is expected for some networks like ZKsync.`,
                });
              } else {
                blockTransactionHashes.add(log.transactionHash);
              }
            }
          }

          return syncTransactionReceipts(blockHash, blockTransactionHashes);
        }),
      ).then((receipts) => receipts.flat());

      await args.syncStore.insertTransactionReceipts({
        transactionReceipts,
        chainId: args.network.chainId,
      });
    }
  };

  const syncBlockFilter = async (filter: BlockFilter, interval: Interval) => {
    const baseOffset = (interval[0] - filter.offset) % filter.interval;
    const offset = baseOffset === 0 ? 0 : filter.interval - baseOffset;

    // Determine which blocks are matched by the block filter.
    const requiredBlocks: number[] = [];
    for (let b = interval[0] + offset; b <= interval[1]; b += filter.interval) {
      requiredBlocks.push(b);
    }

    await Promise.all(requiredBlocks.map((number) => syncBlock(number)));
  };

  const syncTransactionFilter = async (
    filter: TransactionFilter,
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

    const blocks = await Promise.all(
      intervalRange(interval).map((number) => syncBlock(number)),
    );

    const transactionHashes: Set<Hash> = new Set();
    const requiredBlocks: Set<SyncBlock> = new Set();

    for (const block of blocks) {
      block.transactions.map((transaction) => {
        if (
          isTransactionFilterMatched({
            filter,
            block,
            transaction,
            fromChildAddresses,
            toChildAddresses,
          })
        ) {
          transactionHashes.add(transaction.hash);
          requiredBlocks.add(block);
        }
      });
    }

    for (const hash of transactionHashes) {
      transactionsCache.add(hash);
    }

    const transactionReceipts = await Promise.all(
      Array.from(requiredBlocks).map((block) => {
        const blockTransactionHashes = new Set(
          block.transactions
            .filter((t) => transactionHashes.has(t.hash))
            .map((t) => t.hash),
        );
        return syncTransactionReceipts(block.hash, blockTransactionHashes);
      }),
    ).then((receipts) => receipts.flat());

    await args.syncStore.insertTransactionReceipts({
      transactionReceipts,
      chainId: args.network.chainId,
    });
  };

  const syncTraceOrTransferFilter = async (
    filter: TraceFilter | TransferFilter,
    interval: Interval,
  ) => {
    const fromChildAddresses = isAddressFactory(filter.fromAddress)
      ? await syncAddressFactory(filter.fromAddress, interval)
      : undefined;

    const toChildAddresses = isAddressFactory(filter.toAddress)
      ? await syncAddressFactory(filter.toAddress, interval)
      : undefined;

    const requiredBlocks: Set<Hash> = new Set();
    const traces = await Promise.all(
      intervalRange(interval).map(async (number) => {
        let traces = await syncTrace(number);

        // remove unmatched traces
        traces = traces.filter((trace) =>
          filter.type === "trace"
            ? isTraceFilterMatched({
                filter,
                block: { number: toHex(number) },
                trace: trace.trace,
                fromChildAddresses: fromChildAddresses
                  ? new Set(fromChildAddresses)
                  : undefined,
                toChildAddresses: toChildAddresses
                  ? new Set(toChildAddresses)
                  : undefined,
              })
            : isTransferFilterMatched({
                filter,
                block: { number: toHex(number) },
                trace: trace.trace,
                fromChildAddresses: fromChildAddresses
                  ? new Set(fromChildAddresses)
                  : undefined,
                toChildAddresses: toChildAddresses
                  ? new Set(toChildAddresses)
                  : undefined,
              }),
        );

        if (traces.length === 0) return [];

        const block = await syncBlock(number);
        requiredBlocks.add(block.hash);

        return traces.map((trace) => {
          const transaction = block.transactions.find(
            (t) => t.hash === trace.transactionHash,
          );

          if (transaction === undefined) {
            throw new Error(
              `Detected inconsistent RPC responses. 'trace.transactionHash' ${trace.transactionHash} not found in 'block.transactions' ${block.hash}`,
            );
          }

          transactionsCache.add(transaction.hash);

          return { trace, transaction, block };
        });
      }),
    ).then((traces) => traces.flat());

    await args.syncStore.insertTraces({
      traces,
      chainId: args.network.chainId,
    });

    if (shouldGetTransactionReceipt(filter)) {
      const transactionReceipts = await Promise.all(
        Array.from(requiredBlocks).map((blockHash) => {
          const blockTransactionHashes = new Set(
            traces
              .filter((t) => t.block.hash === blockHash)
              .map((t) => t.transaction.hash),
          );
          return syncTransactionReceipts(blockHash, blockTransactionHashes);
        }),
      ).then((receipts) => receipts.flat());

      await args.syncStore.insertTransactionReceipts({
        transactionReceipts,
        chainId: args.network.chainId,
      });
    }
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

      await Promise.all(
        intervalsToSync.map(async ({ filter, interval }) => {
          // Request last block of interval
          const blockPromise = syncBlock(interval[1]);

          try {
            switch (filter.type) {
              case "log": {
                await syncLogFilter(filter as LogFilter, interval);
                break;
              }

              case "block": {
                await syncBlockFilter(filter as BlockFilter, interval);
                break;
              }

              case "transaction": {
                await syncTransactionFilter(
                  filter as TransactionFilter,
                  interval,
                );
                break;
              }

              case "trace":
              case "transfer": {
                await syncTraceOrTransferFilter(
                  filter as TraceFilter | TransferFilter,
                  interval,
                );
                break;
              }
            }
          } catch (_error) {
            const error = _error as Error;

            args.common.logger.error({
              service: "sync",
              msg: `Fatal error: Unable to sync '${args.network.name}' from ${interval[0]} to ${interval[1]}.`,
              error,
            });

            args.onFatalError(error);

            return;
          }

          await blockPromise;
        }),
      );

      const blocks = await Promise.all(blockCache.values());

      await Promise.all([
        args.syncStore.insertBlocks({ blocks, chainId: args.network.chainId }),
        args.syncStore.insertTransactions({
          transactions: blocks.flatMap((block) =>
            block.transactions
              .filter(({ hash }) => transactionsCache.has(hash))
              .map((transaction) => ({
                transaction,
                block,
              })),
          ),
          chainId: args.network.chainId,
        }),
      ]);

      // Add corresponding intervals to the sync-store
      // Note: this should happen after so the database doesn't become corrupted
      if (args.network.disableCache === false) {
        await args.syncStore.insertIntervals({
          intervals: intervalsToSync,
          chainId: args.network.chainId,
        });
      }

      blockCache.clear();
      traceCache.clear();
      transactionsCache.clear();
      blockReceiptsCache.clear();
      transactionReceiptsCache.clear();

      return latestBlock;
    },
  };
};
