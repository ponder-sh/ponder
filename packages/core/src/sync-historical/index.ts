import type { Common } from "@/common/common.js";
import { getHistoricalSyncProgress } from "@/common/metrics.js";
import type { Network } from "@/config/networks.js";
import type { SyncStore } from "@/sync-store/index.js";
import {
  type BlockFilter,
  type CallTraceFilter,
  type Factory,
  type Filter,
  type LogFactory,
  type LogFilter,
  isAddressFactory,
} from "@/sync/source.js";
import type { Source } from "@/sync/source.js";
import type { SyncBlock, SyncCallTrace, SyncLog } from "@/types/sync.js";
import { formatEta, formatPercentage } from "@/utils/format.js";
import {
  type Interval,
  getChunks,
  intervalDifference,
  intervalIntersection,
  intervalSum,
  sortIntervals,
} from "@/utils/interval.js";
import { never } from "@/utils/never.js";
import type { RequestQueue } from "@/utils/requestQueue.js";
import {
  _eth_getBlockByNumber,
  _eth_getLogs,
  _eth_getTransactionReceipt,
  _trace_filter,
} from "@/utils/rpc.js";
import { dedupe } from "@ponder/common";
import { type Address, type Hash, hexToBigInt, hexToNumber, toHex } from "viem";

export type HistoricalSync = {
  /** Closest-to-tip block that is synced. */
  latestBlock: SyncBlock | undefined;
  /** Extract raw data for `interval`. */
  sync(interval: Interval): Promise<void>;
  initializeMetrics(finalizedBlock: SyncBlock, isInitialCall: boolean): void;
  kill(): void;
};

type CreateHistoricalSyncParameters = {
  common: Common;
  sources: Source[];
  syncStore: SyncStore;
  network: Network;
  requestQueue: RequestQueue;
};

export const createHistoricalSync = async (
  args: CreateHistoricalSyncParameters,
): Promise<HistoricalSync> => {
  let isKilled = false;

  /**
   * Blocks that have already been extracted.
   * Note: All entries are deleted at the end of each call to `sync()`.
   */
  const blockCache = new Map<bigint, Promise<SyncBlock>>();
  /**
   * Transactions that should be saved to the sync-store.
   * Note: All entries are deleted at the end of each call to `sync()`.
   */
  const transactionsCache = new Set<Hash>();

  // const logMetadata = new Map<LogFilter, { range: number }>();

  /**
   * Intervals that have been completed for all filters in `args.sources`.
   *
   * Note: `intervalsCache` is not updated after a new interval is synced.
   */
  const intervalsCache: Map<Filter | Factory, Interval[]> = new Map();

  // Populate `intervalsCache` by querying the sync-store.
  for (const { filter } of args.sources) {
    const intervals = await args.syncStore.getIntervals({ filter });
    intervalsCache.set(filter, intervals);
  }

  // Closest-to-tip block that has been fully injested.
  let latestBlock: SyncBlock | undefined;

  /**
   * Attempt to initialize `latestBlock` to the minimum completed block
   * across all filters. This is only possible if every filter has made
   * some progress.
   */
  const _latestCompletedBlocks = args.sources.map(({ filter }) => {
    const requiredInterval = [
      filter.fromBlock,
      filter.toBlock ?? Number.POSITIVE_INFINITY,
    ] satisfies Interval;
    const cachedIntervals = intervalsCache.get(filter)!;

    const completedIntervals = sortIntervals(
      intervalIntersection([requiredInterval], cachedIntervals),
    );

    if (completedIntervals.length === 0) return undefined;

    const earliestCompletedInterval = completedIntervals[0]!;
    if (earliestCompletedInterval[0] !== filter.fromBlock) return undefined;
    return earliestCompletedInterval[1];
  });

  const _minCompletedBlock = Math.min(
    ...(_latestCompletedBlocks.filter(
      (block) => block !== undefined,
    ) as number[]),
  );

  /**  Filter i has known progress if a completed interval is found or if
   * `_latestCompletedBlocks[i]` is undefined but `sources[i].filter.fromBlock`
   * is > `_minCompletedBlock`.
   */
  if (
    _latestCompletedBlocks.every(
      (block, i) =>
        block !== undefined ||
        args.sources[i]!.filter.fromBlock > _minCompletedBlock,
    )
  ) {
    latestBlock = await _eth_getBlockByNumber(args.requestQueue, {
      blockNumber: _minCompletedBlock,
    });
  }

  ////////
  // Helper functions for specific sync tasks
  ////////

  const syncLogFilter = async (filter: LogFilter, interval: Interval) => {
    // Resolve `filter.address`
    let address: Address | Address[] | undefined;
    if (isAddressFactory(filter.address)) {
      const childAddresses = await syncAddress(filter.address, interval);
      // Exit early if no child addresses are found
      if (childAddresses.length === 0) return;
      if (
        childAddresses.length < args.common.options.factoryAddressCountThreshold
      ) {
        address = childAddresses;
      } else {
        address = undefined;
      }
    } else {
      address = filter.address;
    }

    if (isKilled) return;

    // Request logs, batching of large arrays of addresses
    let logs: SyncLog[];
    if (Array.isArray(address) && address.length > 50) {
      const _promises: Promise<SyncLog[]>[] = [];
      for (let i = 0; i < address.length; i += 50) {
        _promises.push(
          _eth_getLogs(args.requestQueue, {
            address: address.slice(i, i + 50),
            topics: filter.topics,
            fromBlock: interval[0],
            toBlock: interval[1],
          }),
        );
      }
      logs = await Promise.all(_promises).then((logs) => logs.flat());
    } else {
      logs = await _eth_getLogs(args.requestQueue, {
        address,
        topics: filter.topics,
        fromBlock: interval[0],
        toBlock: interval[1],
      });
    }

    if (isKilled) return;

    const blocks = await Promise.all(
      logs.map((log) => syncBlock(hexToBigInt(log.blockNumber))),
    );

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

    if (filter.includeTransactionReceipts) {
      const transactionReceipts = await Promise.all(
        [...transactionHashes].map((hash) =>
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

    await Promise.all(requiredBlocks.map((b) => syncBlock(BigInt(b))));
  };

  const syncTraceFilter = async (
    filter: CallTraceFilter,
    interval: Interval,
  ) => {
    // Resolve `filter.toAddress`
    let toAddress: Address[] | undefined;
    if (isAddressFactory(filter.toAddress)) {
      const childAddresses = await syncAddress(filter.toAddress, interval);
      if (
        childAddresses.length < args.common.options.factoryAddressCountThreshold
      ) {
        toAddress = childAddresses;
      } else {
        toAddress = undefined;
      }
    } else {
      toAddress = filter.toAddress;
    }

    if (isKilled) return;

    let callTraces = await _trace_filter(args.requestQueue, {
      fromAddress: filter.fromAddress,
      toAddress,
      fromBlock: interval[0],
      toBlock: interval[1],
    }).then(
      (traces) =>
        traces.flat().filter((t) => t.type === "call") as SyncCallTrace[],
    );

    if (isKilled) return;

    // Request transactionReceipts to check for reverted transactions.
    const transactionReceipts = await Promise.all(
      dedupe(callTraces.map((t) => t.transactionHash)).map((hash) =>
        _eth_getTransactionReceipt(args.requestQueue, {
          hash,
        }),
      ),
    );

    const revertedTransactions = new Set<Hash>();
    for (const receipt of transactionReceipts) {
      if (receipt.status === "0x0") {
        revertedTransactions.add(receipt.transactionHash);
      }
    }

    callTraces = callTraces.filter(
      (trace) => revertedTransactions.has(trace.transactionHash) === false,
    );

    if (isKilled) return;

    const blocks = await Promise.all(
      callTraces.map((trace) => syncBlock(hexToBigInt(trace.blockNumber))),
    );

    for (const { transactionHash } of callTraces) {
      transactionsCache.add(transactionHash);
    }

    if (isKilled) return;

    await args.syncStore.insertCallTraces({
      callTraces: callTraces.map((callTrace, i) => ({
        callTrace,
        block: blocks[i]!,
      })),
      chainId: args.network.chainId,
    });
  };

  /** Extract and insert the log-based addresses that match `filter` + `interval`. */
  const syncLogFactory = async (filter: LogFactory, interval: Interval) => {
    const logs = await _eth_getLogs(args.requestQueue, {
      address: filter.address,
      topics: [filter.eventSelector],
      fromBlock: interval[0],
      toBlock: interval[1],
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
   * Extract block, using `blockCache` to avoid fetching
   * the same block twice. Also, update `latestBlock`.
   *
   * @param number Block to be extracted
   * @param transactionHashes Hashes to be inserted into the sync-store
   *
   * Note: This function could more accurately skip network requests by taking
   * advantage of `syncStore.hasBlock` and `syncStore.hasTransaction`.
   */
  const syncBlock = async (number: bigint): Promise<SyncBlock> => {
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
        hexToBigInt(block.number) > hexToBigInt(latestBlock?.number ?? "0x0")
      ) {
        latestBlock = block;
      }
    }

    return block;
  };

  /**
   * Return all addresses that match `filter` after extracting addresses
   * that match `filter` and `interval`.
   */
  const syncAddress = async (
    filter: Factory,
    interval: Interval,
  ): Promise<Address[]> => {
    await syncLogFactory(filter, interval);

    // Query the sync-store for all addresses that match `filter`.
    return await args.syncStore.getChildAddresses({
      filter,
      limit: args.common.options.factoryAddressCountThreshold,
    });
  };

  // Emit progress update logs on an interval for each source.
  const interval = setInterval(async () => {
    const historical = await getHistoricalSyncProgress(args.common.metrics);

    for (const {
      networkName,
      sourceName,
      progress,
      eta,
    } of historical.sources) {
      if (progress === 1 || networkName !== args.network.name) return;
      args.common.logger.info({
        service: "historical",
        msg: `Syncing '${networkName}' for '${sourceName}' with ${formatPercentage(
          progress ?? 0,
        )} complete${eta !== undefined ? ` and ~${formatEta(eta)} remaining` : ""}`,
      });
    }
  }, 10_000);

  return {
    get latestBlock() {
      return latestBlock;
    },
    async sync(_interval) {
      await Promise.all(
        args.sources.map(async (source) => {
          // Compute the required interval to sync, accounting for cached
          // intervals and start + end block.

          // Skip sync if the interval is after the `toBlock` or before
          // the `fromBlock`.
          if (
            source.filter.fromBlock > _interval[1] ||
            (source.filter.toBlock && source.filter.toBlock < _interval[0])
          ) {
            return;
          }
          const interval: Interval = [
            Math.max(source.filter.fromBlock, _interval[0]),
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
          const blockPromise = syncBlock(BigInt(interval[1]));

          // TODO(kyle) use filter metadata for recommended "eth_getLogs" chunk size

          // sync required intervals, account for chunk sizes
          await Promise.all(
            requiredIntervals.map(async (interval) => {
              if (source.type === "contract") {
                const filter = source.filter;
                switch (filter.type) {
                  case "log": {
                    const maxChunkSize =
                      source.maxBlockRange ?? args.network.defaultMaxBlockRange;
                    await Promise.all(
                      getChunks({ interval, maxChunkSize }).map(
                        async (interval) => {
                          await syncLogFilter(filter, interval);
                          args.common.metrics.ponder_historical_completed_blocks.inc(
                            {
                              network: source.networkName,
                              source: source.name,
                              type: source.filter.type,
                            },
                            interval[1] - interval[0] + 1,
                          );
                        },
                      ),
                    );
                    break;
                  }

                  case "callTrace":
                    await Promise.all(
                      getChunks({ interval, maxChunkSize: 10 }).map(
                        async (interval) => {
                          await syncTraceFilter(filter, interval);

                          args.common.metrics.ponder_historical_completed_blocks.inc(
                            {
                              network: source.networkName,
                              source: source.name,
                              type: source.filter.type,
                            },
                            interval[1] - interval[0] + 1,
                          );
                        },
                      ),
                    );
                    break;

                  default:
                    never(filter);
                }
              } else {
                await syncBlockFilter(source.filter, interval);

                args.common.metrics.ponder_historical_completed_blocks.inc(
                  {
                    network: source.networkName,
                    source: source.name,
                    type: source.filter.type,
                  },
                  interval[1] - interval[0] + 1,
                );
              }
            }),
          );

          if (isKilled) return;

          await blockPromise;

          // Mark `interval` for `filter` as completed in the sync-store
          await args.syncStore.insertInterval({
            filter: source.filter,
            interval,
          });
        }),
      );

      const blocks = await Promise.all(blockCache.values());

      await Promise.all([
        args.syncStore.insertBlocks({ blocks, chainId: args.network.chainId }),
        args.syncStore.insertTransactions({
          transactions: blocks.flatMap(({ transactions }) =>
            transactions.filter(({ hash }) => transactionsCache.has(hash)),
          ),
          chainId: args.network.chainId,
        }),
      ]);
      blockCache.clear();
      transactionsCache.clear();
    },
    initializeMetrics(finalizedBlock, isInitialCall) {
      if (isInitialCall) {
        args.common.metrics.ponder_historical_start_timestamp.set(Date.now());
        args.common.metrics.ponder_realtime_is_connected.set(
          { network: args.network.name },
          0,
        );
      }

      for (const source of args.sources) {
        const label = {
          network: source.networkName,
          source: source.name,
          type: source.filter.type,
        };

        if (source.filter.fromBlock > hexToNumber(finalizedBlock.number)) {
          args.common.metrics.ponder_historical_total_blocks.set(label, 0);

          if (isInitialCall) {
            args.common.logger.warn({
              service: "historical",
              msg: `Skipped syncing '${source.networkName}' for '${source.name}' because the start block is not finalized`,
            });
          }

          args.common.metrics.ponder_historical_total_blocks.set(label, 0);
          args.common.metrics.ponder_historical_cached_blocks.set(label, 0);
        } else {
          const interval = [
            source.filter.fromBlock,
            source.filter.toBlock ?? hexToNumber(finalizedBlock.number),
          ] satisfies Interval;

          const requiredIntervals = intervalDifference(
            [interval],
            intervalsCache.get(source.filter)!,
          );

          const totalBlocks = interval[1] - interval[0] + 1;
          const cachedBlocks = totalBlocks - intervalSum(requiredIntervals);

          args.common.metrics.ponder_historical_total_blocks.set(
            label,
            totalBlocks,
          );

          args.common.metrics.ponder_historical_cached_blocks.set(
            label,
            cachedBlocks,
          );

          if (isInitialCall) {
            args.common.logger.info({
              service: "historical",
              msg: `Started syncing '${source.networkName}' for '${
                source.name
              }' with ${formatPercentage(
                Math.min(1, cachedBlocks / (totalBlocks || 1)),
              )} cached`,
            });
          }
        }
      }
    },
    kill() {
      isKilled = true;
      clearInterval(interval);
    },
  };
};
