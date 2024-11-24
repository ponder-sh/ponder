import type { Common } from "@/common/common.js";
import type { Network } from "@/config/networks.js";
import {
  isTraceFilterMatched,
  isTransactionFilterMatched,
  isTransferFilterMatched,
} from "@/sync-realtime/filter.js";
import type { SyncStore } from "@/sync-store/index.js";
import {
  type BlockFilter,
  type Factory,
  type Filter,
  type LogFactory,
  type LogFilter,
  type TraceFilter,
  type TransferFilter,
  isAddressFactory,
  shouldGetTransactionReceipt,
} from "@/sync/source.js";
import type { Source, TransactionFilter } from "@/sync/source.js";
import type { SyncBlock, SyncLog, SyncTrace } from "@/types/sync.js";
import {
  type Interval,
  getChunks,
  intervalDifference,
  intervalRange,
} from "@/utils/interval.js";
import { never } from "@/utils/never.js";
import type { RequestQueue } from "@/utils/requestQueue.js";
import {
  _debug_traceBlockByNumber,
  _eth_getBlockByNumber,
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
} from "viem";

export type HistoricalSync = {
  intervalsCache: Map<Filter, Interval[]>;
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
  let intervalsCache: Map<Filter, Interval[]>;
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
  const syncAddress = async (
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
      ? await syncAddress(filter.address, interval)
      : filter.address;

    if (isKilled) return;

    const logs = await syncLogsDynamic({ filter, interval, address });

    if (isKilled) return;

    const blocks = await Promise.all(
      logs.map((log) => syncBlock(hexToNumber(log.blockNumber))),
    );

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
        throw new Error(
          `Detected inconsistent RPC responses. 'log.transactionHash' ${log.transactionHash} not found in 'block.transactions' ${block.hash}`,
        );
      }
    }

    const transactionHashes = new Set(logs.map((l) => l.transactionHash));
    for (const hash of transactionHashes) {
      transactionsCache.add(hash);
    }

    if (isKilled) return;

    await args.syncStore.insertLogs({
      logs: logs.map((log, i) => ({ log, block: blocks[i]! })),
      shouldUpdateCheckpoint: true,
      chainId: args.network.chainId,
    });

    if (isKilled) return;

    if (shouldGetTransactionReceipt(filter)) {
      const transactionReceipts = await Promise.all(
        Array.from(transactionHashes).map((hash) =>
          _eth_getTransactionReceipt(args.requestQueue, { hash }),
        ),
      );

      if (isKilled) return;

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
    const fromAddress = isAddressFactory(filter.fromAddress)
      ? await syncAddress(filter.fromAddress, interval)
      : filter.fromAddress;

    const toAddress = isAddressFactory(filter.toAddress)
      ? await syncAddress(filter.toAddress, interval)
      : filter.toAddress;

    if (isKilled) return;

    const blocks = await Promise.all(
      intervalRange(interval).map((number) => syncBlock(number)),
    );

    if (isKilled) return;

    const transactionHashes: Set<Hash> = new Set();

    for (const block of blocks) {
      block.transactions.map((transaction) => {
        if (
          isTransactionFilterMatched({
            filter: {
              ...filter,
              fromAddress: fromAddress,
              toAddress: toAddress,
            },
            block,
            transaction,
          })
        ) {
          transactionHashes.add(transaction.hash);
        }
      });
    }

    for (const hash of transactionHashes) {
      transactionsCache.add(hash);
    }

    if (isKilled) return;

    const transactionReceipts = await Promise.all(
      Array.from(transactionHashes).map((hash) =>
        _eth_getTransactionReceipt(args.requestQueue, { hash }),
      ),
    );

    if (isKilled) return;

    await args.syncStore.insertTransactionReceipts({
      transactionReceipts,
      chainId: args.network.chainId,
    });
  };

  const syncTraceOrTransferFilter = async (
    filter: TraceFilter | TransferFilter,
    interval: Interval,
  ) => {
    const fromAddress = isAddressFactory(filter.fromAddress)
      ? await syncAddress(filter.fromAddress, interval)
      : filter.fromAddress;

    const toAddress = isAddressFactory(filter.toAddress)
      ? await syncAddress(filter.toAddress, interval)
      : filter.toAddress;

    const traces = await Promise.all(
      intervalRange(interval).map(async (number) => {
        let traces = await syncTrace(number);

        // remove unmatched traces
        traces = traces.filter((trace) =>
          filter.type === "trace"
            ? isTraceFilterMatched({
                filter: {
                  ...filter,
                  fromAddress,
                  toAddress,
                },
                block: { number: toHex(number) },
                trace: trace.trace,
              })
            : isTransferFilterMatched({
                filter: {
                  ...filter,
                  fromAddress,
                  toAddress,
                },
                block: { number: toHex(number) },
                trace: trace.trace,
              }),
        );

        if (traces.length === 0) return [];

        const block = await syncBlock(number);

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

    if (isKilled) return;

    await args.syncStore.insertTraces({
      traces,
      chainId: args.network.chainId,
    });

    if (isKilled) return;

    if (shouldGetTransactionReceipt(filter)) {
      const transactionHashes = new Set(
        traces.map(({ transaction }) => transaction.hash),
      );

      const transactionReceipts = await Promise.all(
        Array.from(transactionHashes).map((hash) =>
          _eth_getTransactionReceipt(args.requestQueue, { hash }),
        ),
      );

      if (isKilled) return;

      await args.syncStore.insertTransactionReceipts({
        transactionReceipts,
        chainId: args.network.chainId,
      });
    }
  };

  return {
    intervalsCache,
    async sync(_interval) {
      const syncedIntervals: { filter: Filter; interval: Interval }[] = [];

      await Promise.all(
        args.sources.map(async (source) => {
          // Compute the required interval to sync, accounting for cached
          // intervals and start + end block.

          // Skip sync if the interval is after the `toBlock` or before
          // the `fromBlock`.
          if (
            (source.filter.fromBlock !== undefined &&
              source.filter.fromBlock > _interval[1]) ||
            (source.filter.toBlock !== undefined &&
              source.filter.toBlock < _interval[0])
          ) {
            return;
          }
          const interval: Interval = [
            Math.max(source.filter.fromBlock ?? 0, _interval[0]),
            Math.min(
              source.filter.toBlock ?? Number.POSITIVE_INFINITY,
              _interval[1],
            ),
          ];
          const completedIntervals = intervalsCache.get(source.filter)!;
          const requiredIntervals = intervalDifference(
            [interval],
            completedIntervals,
          );

          // Skip sync if the interval is already complete.
          if (requiredIntervals.length === 0) return;

          // Request last block of interval
          const blockPromise = syncBlock(interval[1]);

          try {
            // sync required intervals, account for chunk sizes
            await Promise.all(
              requiredIntervals.map(async (interval) => {
                const filter = source.filter;
                switch (filter.type) {
                  case "log": {
                    await syncLogFilter(filter, interval);
                    break;
                  }

                  case "block": {
                    await syncBlockFilter(filter, interval);
                    break;
                  }

                  case "transaction": {
                    await syncTransactionFilter(filter, interval);
                    break;
                  }

                  case "trace":
                  case "transfer": {
                    await syncTraceOrTransferFilter(filter, interval);
                    break;
                  }

                  default:
                    never(filter);
                }
              }),
            );
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

          if (isKilled) return;

          await blockPromise;

          syncedIntervals.push({ filter: source.filter, interval });
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
          intervals: syncedIntervals,
        });
      }

      blockCache.clear();
      traceCache.clear();
      transactionsCache.clear();

      return latestBlock;
    },
    kill() {
      isKilled = true;
    },
  };
};
