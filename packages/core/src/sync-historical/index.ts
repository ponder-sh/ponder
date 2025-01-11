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
import type {
  LightSyncBlock,
  LightSyncTrace,
  SyncBlock,
  SyncLog,
} from "@/types/sync.js";
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
   * Flag to fetch transaction receipts through _eth_getBlockReceipts (true) or _eth_getTransactionReceipt (false)
   */
  let isBlockReceipts = true;
  /**
   * Blocks that have already been extracted and inserted into syncStore.
   * Note: All entries are deleted at the end of each call to `sync()`.
   */
  const insertedBlocks = new Map<number, Promise<LightSyncBlock>>();
  /**
   * Traces that have already been extracted and inserted into syncStore.
   * Note: All entries are deleted at the end of each call to `sync()`.
   */
  const insertedTraces = new Map<number, Promise<LightSyncTrace[]>>();
  /**
   * Block receipts that have already been extracted and inserted into syncStore.
   * Note: All entries are deleted at the end of each call to `sync()`.
   */
  const insertedBlockReceipts = new Map<Hash, Promise<Set<Hash>>>();
  /**
   * Transaction receipts that have already been extracted and inserted into syncStore.
   * Note: All entries are deleted at the end of each call to `sync()`.
   */
  const insertedTransactionReceipts = new Set<Hash>();
  /**
   * Traces that need to be saved permanently into syncStore.
   * Note: All entries are deleted at the end of each call to `sync()`.
   */
  const traceCache = new Set<Hash>();
  /**
   * Transactions that need to be saved permanently into syncStore.
   * Note: All entries are deleted at the end of each call to `sync()`.
   */
  const transactionsCache = new Set<Hash>();
  /**
   * Transactions receipts that need to be saved permanently into syncStore.
   * Note: All entries are deleted at the end of each call to `sync()`.
   */
  const transactionReceiptsCache = new Set<Hash>();
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

  /**
   * Extract block, using `insertedBlocks` to avoid fetching
   * the same block twice. Also, update `latestBlock`.
   *
   * @param number Block to be extracted
   *
   * Note: This function could more accurately skip network requests by taking
   * advantage of `syncStore.hasBlock` and `syncStore.hasTransaction`.
   */
  const syncBlock = async (number: number): Promise<LightSyncBlock> => {
    let lightBlock: LightSyncBlock;

    /**
     * `insertedBlocks` contains all blocks that have been extracted during the
     * current call to `sync()`. If `number` is present in `insertedBlocks` use it,
     * otherwise, request the block and add it to `insertedBlocks` and the sync-store.
     */

    if (insertedBlocks.has(number)) {
      lightBlock = await insertedBlocks.get(number)!;
    } else {
      const _lightBlock = (async () => {
        const block = await _eth_getBlockByNumber(args.requestQueue, {
          blockNumber: toHex(number),
        });

        // Insert the block and transactions into the syncStore
        await Promise.all([
          args.syncStore.insertBlocks({
            blocks: [block],
            chainId: args.network.chainId,
          }),
          args.syncStore.insertTransactions({
            transactions: block.transactions.map((transaction) => ({
              transaction,
              block,
            })),
            chainId: args.network.chainId,
          }),
        ]);

        // Update `latestBlock` if `block` is closer to tip.
        if (
          hexToBigInt(block.number) >= hexToBigInt(latestBlock?.number ?? "0x0")
        ) {
          latestBlock = block;
        }

        return {
          hash: block.hash,
          number: block.number,
          timestamp: block.number,
          transactions: block.transactions,
        };
      })();

      insertedBlocks.set(number, _lightBlock);
      lightBlock = await _lightBlock;
    }

    return lightBlock;
  };

  /** Extract and insert traces for the given block into syncStore */
  const syncTrace = async (number: number): Promise<LightSyncTrace[]> => {
    let lightTraces: LightSyncTrace[];
    if (insertedTraces.has(number)) {
      lightTraces = await insertedTraces.get(number)!;
    } else {
      const _lightTraces = (async () => {
        const _traces = await _debug_traceBlockByNumber(args.requestQueue, {
          blockNumber: toHex(number),
        });

        const block = await syncBlock(number);

        // Validate _debug_traceBlockByNumber response before inserting into syncStore
        const traces = _traces.map((trace) => {
          const transaction = block.transactions.find(
            (t) => t.hash === trace.transactionHash,
          );

          if (transaction === undefined) {
            throw new Error(
              `Detected inconsistent RPC responses. 'trace.transactionHash' ${trace.transactionHash} not found in 'block.transactions' ${block.hash}`,
            );
          }

          return { trace, transaction, block };
        });

        // Insert the block and transactions into the syncStore
        await args.syncStore.insertTraces({
          traces,
          chainId: args.network.chainId,
        });

        return _traces.map(({ trace, transactionHash }) => ({
          trace: {
            from: trace.from,
            to: trace.to,
            type: trace.type,
            input: trace.input,
            index: trace.index,
          },
          transactionHash,
        }));
      })();

      insertedTraces.set(number, _lightTraces);

      lightTraces = await _lightTraces;
    }

    return lightTraces;
  };

  /** Extract and insert transactionReceipts into syncStore */
  const syncTransactionReceipts = async (
    block: Hash,
    transactionHashes: Set<Hash>,
  ): Promise<void> => {
    // 1. If there are no transactionReceipts to get, just return.
    if (transactionHashes.size === 0) return;

    // 2. If there are cached blockReceipts for this block.
    if (insertedBlockReceipts.has(block)) {
      const blockReceiptsTransactionHashes =
        await insertedBlockReceipts.get(block)!;
      // Validate that block transaction receipts include all required transactions
      for (const hash of Array.from(transactionHashes)) {
        if (blockReceiptsTransactionHashes.has(hash) === false) {
          throw new Error(
            `Detected inconsistent RPC responses. 'transaction.hash' ${hash} not found in eth_getBlockReceipts response for block '${block}'`,
          );
        }
      }

      return;
    }

    // 3. If _eth_getBlockReceipts failed previously, fetch receipts individually.
    if (isBlockReceipts === false) {
      const requiredTransactionReceipts = Array.from(transactionHashes).filter(
        (hash) => insertedTransactionReceipts.has(hash) === false,
      );

      if (requiredTransactionReceipts.length === 0) return;

      const transactionReceipts = await Promise.all(
        requiredTransactionReceipts.map((hash) =>
          _eth_getTransactionReceipt(args.requestQueue, {
            hash,
          }),
        ),
      );

      await args.syncStore.insertTransactionReceipts({
        transactionReceipts,
        chainId: args.network.chainId,
      });

      for (const receipt of transactionReceipts) {
        insertedTransactionReceipts.add(receipt.transactionHash);
      }

      return;
    }

    // 4. Otherwise, fetch receipts via `_eth_getBlockReceipts`. If failed, disable this method and fetch receipts individually.
    let blockReceiptsTransactionHashes: Promise<Set<Hash>>;
    try {
      blockReceiptsTransactionHashes = (async () => {
        const blockReceipts = await _eth_getBlockReceipts(args.requestQueue, {
          blockHash: block,
        });

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

        await args.syncStore.insertTransactionReceipts({
          transactionReceipts: blockReceipts,
          chainId: args.network.chainId,
        });

        return blockReceiptsTransactionHashes;
      })();

      insertedBlockReceipts.set(block, blockReceiptsTransactionHashes);
      await blockReceiptsTransactionHashes;

      return;
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

  const syncLogFilter = async (filter: LogFilter, interval: Interval) => {
    // Resolve `filter.address`
    const address = isAddressFactory(filter.address)
      ? await syncAddressFactory(filter.address, interval)
      : filter.address;

    if (isKilled) return;

    const logs = await syncLogsDynamic({ filter, interval, address });

    if (isKilled) return;

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
    for (const hash of Array.from(transactionHashes)) {
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
      await Promise.all(
        Array.from(requiredBlocks).map(async (blockHash) => {
          const blockTransactionHashes = new Set(
            logs
              .filter((l) => l.blockHash === blockHash)
              .map((l) => l.transactionHash),
          );

          await syncTransactionReceipts(blockHash, blockTransactionHashes);

          for (const hash of Array.from(blockTransactionHashes)) {
            transactionReceiptsCache.add(hash);
          }
        }),
      );
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

    if (isKilled) return;

    const blocks = await Promise.all(
      intervalRange(interval).map((number) => syncBlock(number)),
    );

    if (isKilled) return;

    const transactionHashes: Set<Hash> = new Set();
    const requiredBlocks: Set<LightSyncBlock> = new Set();

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

    for (const hash of Array.from(transactionHashes)) {
      transactionsCache.add(hash);
    }

    if (isKilled) return;

    await Promise.all(
      Array.from(requiredBlocks).map(async (block) => {
        const blockTransactionHashes = new Set(
          block.transactions
            .filter((t) => transactionHashes.has(t.hash))
            .map((t) => t.hash),
        );

        await syncTransactionReceipts(block.hash, blockTransactionHashes);

        for (const hash of Array.from(blockTransactionHashes)) {
          transactionReceiptsCache.add(hash);
        }
      }),
    );
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

    await Promise.all(
      intervalRange(interval).map(async (number) => {
        let traces = await syncTrace(number);

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

        if (traces.length === 0) return;

        for (const trace of traces) {
          traceCache.add(`${trace.transactionHash}-${trace.trace.index}`);
          transactionsCache.add(trace.transactionHash);
        }

        const block = await syncBlock(number);

        if (shouldGetTransactionReceipt(filter)) {
          const blockTransactionHashes = new Set(
            traces.map((t) => t.transactionHash),
          );

          await syncTransactionReceipts(block.hash, blockTransactionHashes);

          for (const hash of Array.from(blockTransactionHashes)) {
            transactionReceiptsCache.add(hash);
          }
        }
      }),
    );
  };

  return {
    intervalsCache,
    async sync(_interval) {
      const syncedIntervals: { filter: Filter; interval: Interval }[] = [];

      await Promise.all(
        args.sources.map(async (source) => {
          const filter = source.filter;

          // Compute the required interval to sync, accounting for cached
          // intervals and start + end block.

          // Skip sync if the interval is after the `toBlock` or before
          // the `fromBlock`.
          if (
            (filter.fromBlock !== undefined &&
              filter.fromBlock > _interval[1]) ||
            (filter.toBlock !== undefined && filter.toBlock < _interval[0])
          ) {
            return;
          }
          const interval: Interval = [
            Math.max(filter.fromBlock ?? 0, _interval[0]),
            Math.min(filter.toBlock ?? Number.POSITIVE_INFINITY, _interval[1]),
          ];
          const completedIntervals = intervalsCache.get(filter)!;
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

          syncedIntervals.push({ filter, interval });
        }),
      );

      const blocks = await Promise.all(insertedBlocks.values());
      const blockReceipts = await Promise.all(insertedBlockReceipts.values());
      const blockTraces = await Promise.all(insertedTraces.values());

      await Promise.all([
        args.syncStore.deleteTransactions({
          transactions: blocks
            .flatMap(({ transactions }) => transactions.map((t) => t.hash))
            .filter((hash) => transactionsCache.has(hash) === false),
          chainId: args.network.chainId,
        }),
        args.syncStore.deleteTransactionReceipts({
          transactionReceipts: blockReceipts
            .flatMap((receipts) => Array.from(receipts))
            .filter((hash) => transactionReceiptsCache.has(hash) === false),
          chainId: args.network.chainId,
        }),
        args.syncStore.deleteTransactionReceipts({
          transactionReceipts: Array.from(insertedTransactionReceipts).filter(
            (hash) => transactionReceiptsCache.has(hash) === false,
          ),
          chainId: args.network.chainId,
        }),
        args.syncStore.deleteTraces({
          traces: blockTraces
            .flat()
            .filter(
              (trace) =>
                traceCache.has(
                  `${trace.transactionHash}-${trace.trace.index}`,
                ) === false,
            ),
          chainId: args.network.chainId,
        }),
      ]);

      // Add corresponding intervals to the sync-store
      // Note: this should happen after so the database doesn't become corrupted
      if (args.network.disableCache === false) {
        await args.syncStore.insertIntervals({
          intervals: syncedIntervals,
          chainId: args.network.chainId,
        });
      }

      insertedBlocks.clear();
      insertedTraces.clear();
      insertedBlockReceipts.clear();
      insertedTransactionReceipts.clear();

      traceCache.clear();
      transactionsCache.clear();
      transactionReceiptsCache.clear();

      return latestBlock;
    },
    kill() {
      isKilled = true;
    },
  };
};
