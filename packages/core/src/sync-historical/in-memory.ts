import {
  Array as Arr,
  Deferred,
  Effect,
  Fiber,
  Option,
  Pull,
  Stream,
} from "effect";
import {
  type Address,
  type Hash,
  hexToNumber,
  numberToHex,
  toHex,
  zeroHash,
} from "viem";
import { Options } from "@/internal/options.js";
import type {
  Chain,
  Factory,
  Filter,
  LogFilter,
  SyncBlock,
  SyncLog,
  SyncTrace,
  SyncTransaction,
} from "@/internal/types.js";
import {
  debug_traceBlockByNumber,
  eth_getBlockByNumber,
  eth_getLogsWithPagination,
  eth_getTransactionReceipts,
  validateLogsAndBlock,
  validateReceiptsAndBlock,
  validateTracesAndBlock,
  validateTransactionsAndBlock,
} from "@/rpc/actions.js";
import { type Rpc, sanitizeLogTopics } from "@/rpc/index.js";
import {
  syncBlockToInternal,
  syncLogToInternal,
  syncTraceToInternal,
  syncTransactionReceiptToInternal,
  syncTransactionToInternal,
} from "@/runtime/events.js";
import {
  getChildAddress,
  getFilterFactories,
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
import { type Interval, intervalBounds } from "@/utils/interval.js";
import { startClockEffect } from "@/utils/timer.js";

type BlockData = Effect.Success<ReturnType<SyncStore["getEventData"]>>;

export type InMemoryHistoricalSync = {
  /**
   * Stream the data of each required block, in order.
   *
   * @dev Fetches at most `MAX_BLOCKS_IN_MEM` blocks ahead of the consumer.
   */
  syncBlockData(params: {
    requiredIntervals: IntervalWithFilter[];
    requiredFactoryIntervals: IntervalWithFactory[];
  }): Stream.Stream<BlockData, Error>;
};

export const createInMemoryHistoricalSync = (params: {
  chain: Chain;
  rpc: Rpc;
  childAddress: ChildAddresses;
}): Effect.Effect<InMemoryHistoricalSync, never, Options> =>
  Effect.gen(function* () {
    const options = yield* Options;

    const historicalSync: InMemoryHistoricalSync = {
      syncBlockData: ({ requiredIntervals, requiredFactoryIntervals }) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const context = { logAnnotations: { action: "fetch_block_data" } };
            const scope = yield* Effect.scope;

            const factoryIntervalsById = new Map<
              Factory["id"],
              IntervalWithFactory
            >();

            for (const { factory, interval } of requiredFactoryIntervals) {
              const existing = factoryIntervalsById.get(factory.id);
              factoryIntervalsById.set(factory.id, {
                factory,
                interval: existing
                  ? intervalBounds([existing.interval, interval])
                  : interval,
              });
            }

            /**
             * Fetch the child addresses of `factory` in `interval`, one page for each
             * pull. Emits the last block of each page.
             */
            const fetchChildAddressesWithPagination = (
              factory: Factory,
              interval: Interval,
            ): Stream.Stream<number, Error> => {
              const factoryChildAddresses = params.childAddress.get(
                factory.id,
              )!;

              return withPullClock(
                eth_getLogsWithPagination(
                  params.rpc,
                  [
                    {
                      address: factory.address,
                      topics: [factory.eventSelector],
                      fromBlock: numberToHex(interval[0]),
                      toBlock: numberToHex(interval[1]),
                    },
                  ],
                  {
                    ...context,
                    ethGetLogsBlockRange: params.chain.ethGetLogsBlockRange,
                  },
                ),
              ).pipe(
                Stream.mapEffect(({ value: page, endClock }) =>
                  Effect.gen(function* () {
                    let childAddressCount = 0;

                    for (const log of page.logs) {
                      if (isLogFactoryMatched({ factory, log }) === false) {
                        continue;
                      }

                      let address: Address;
                      try {
                        address = getChildAddress({ log, factory });
                      } catch (error) {
                        if (factory.address !== undefined) {
                          return yield* Effect.fail(error as Error);
                        }
                        yield* Effect.logDebug({
                          msg: "Failed to extract child address from log matched by factory using the provided ABI item",
                          chain: params.chain.name,
                          chain_id: params.chain.id,
                          factory: factory.sourceId,
                          block_number: hexToNumber(log.blockNumber),
                          log_index: hexToNumber(log.logIndex),
                          data: log.data,
                          topics: JSON.stringify(log.topics),
                        });
                        continue;
                      }

                      const blockNumber = hexToNumber(log.blockNumber);
                      const existingBlockNumber =
                        factoryChildAddresses.get(address);
                      if (
                        existingBlockNumber === undefined ||
                        existingBlockNumber > blockNumber
                      ) {
                        factoryChildAddresses.set(address, blockNumber);
                        childAddressCount++;
                      }
                    }

                    yield* Effect.logDebug(
                      {
                        msg: "Fetched block range data",
                        chain: params.chain.name,
                        chain_id: params.chain.id,
                        data_type: "factory_log",
                        block_range: JSON.stringify([
                          page.fromBlock,
                          page.toBlock,
                        ]),
                        log_count: page.logs.length,
                        child_address_count: childAddressCount,
                        duration: yield* endClock,
                      },
                      ["chain", "data_type", "block_range"],
                    );

                    return page.toBlock;
                  }),
                ),
              );
            };

            /**
             * Closest-to-tip block with all child addresses fetched (inclusive), for each
             * factory. `Infinity` once all child addresses are fetched.
             *
             * Note: Factories are not part of `mergeIntervalStreams`. Instead, the filters
             * that depend on a factory pull its pages when they need more child addresses.
             */
            const factoryProgress = new Map<Factory["id"], number>();
            /**
             * Pull the next page of child addresses of each factory. Returns the last block
             * of the page, or `Infinity` once all pages are fetched.
             *
             * Note: The pulls of a factory run one at a time, in the order they are made, like
             * `next()` calls of an async generator. A pull starts as soon as the previous one
             * completes, before its caller continues.
             */
            const factoryPages = new Map<
              Factory["id"],
              Effect.Effect<number, Error>
            >();

            for (const { factory, interval } of factoryIntervalsById.values()) {
              factoryProgress.set(factory.id, interval[0] - 1);

              const pull = yield* Stream.toPull(
                fetchChildAddressesWithPagination(factory, interval),
              );
              /** Completes when the last pull of the factory is done. */
              let lastPull = yield* Deferred.make<void>();
              yield* Deferred.succeed(lastPull, undefined);

              factoryPages.set(
                factory.id,
                Effect.gen(function* () {
                  const previousPull = lastPull;
                  const currentPull = yield* Deferred.make<void>();
                  lastPull = currentPull;

                  return yield* Deferred.await(previousPull).pipe(
                    Effect.andThen(pull),
                    Effect.map(([toBlock]) => toBlock),
                    Pull.catchDone(() =>
                      Effect.succeed(Number.POSITIVE_INFINITY),
                    ),
                    Effect.ensuring(Deferred.succeed(currentPull, undefined)),
                  );
                }),
              );
            }

            /**
             * Logs keyed by block number, then by log index.
             */
            const perBlockLogs = new Map<number, Map<number, SyncLog>>();

            const intervalStreams = new Map<
              IntervalWithFilter,
              Stream.Stream<Interval, Error>
            >();

            /**
             * Emit the sub-intervals of `interval` for which all `factories`
             * have fetched child addresses. Fetches factory pages as needed.
             */
            const paginateFactoryDependencies = (
              interval: Interval,
              factories: Factory["id"][],
            ): Stream.Stream<Interval, Error> =>
              Stream.paginate<number, Interval, Error>(interval[0], (cursor) =>
                Effect.gen(function* () {
                  const behind = factories.filter(
                    (id) =>
                      (factoryProgress.get(id) ?? Number.POSITIVE_INFINITY) <
                      cursor,
                  );

                  if (behind.length > 0) {
                    // Note: Concurrent pulls of one factory's pages are queued, so filters
                    // that depend on the same factory do not repeat requests.
                    yield* Effect.forEach(
                      behind,
                      (id) =>
                        Effect.gen(function* () {
                          const progress = yield* factoryPages.get(id)!;
                          factoryProgress.set(id, progress);
                        }),
                      { concurrency: "unbounded", discard: true },
                    );
                    return [[], Option.some(cursor)] as const;
                  }

                  const progressBlock = Math.min(
                    interval[1],
                    ...factories.map(
                      (id) =>
                        factoryProgress.get(id) ?? Number.POSITIVE_INFINITY,
                    ),
                  );
                  return [
                    [[cursor, progressBlock] satisfies Interval],
                    progressBlock < interval[1]
                      ? Option.some(progressBlock + 1)
                      : Option.none(),
                  ] as const;
                }),
              );

            /**
             * Fetch the logs of `filter` in `interval`, one page for each pull, after
             * the child addresses of its factory. Emits the interval of each page.
             */
            const fetchLogsWithPagination = (
              filter: LogFilter,
              interval: Interval,
            ): Stream.Stream<Interval, Error> => {
              const factory = isAddressFactory(filter.address)
                ? filter.address
                : undefined;

              return paginateFactoryDependencies(
                interval,
                factory ? [factory.id] : [],
              ).pipe(
                Stream.flatMap((factoryInterval) => {
                  let address: Address | Address[] | undefined;
                  if (factory) {
                    const childAddresses = params.childAddress.get(factory.id)!;
                    if (childAddresses.size === 0) {
                      return Stream.make(factoryInterval);
                    }

                    address =
                      childAddresses.size >=
                      options.factoryAddressCountThreshold
                        ? undefined
                        : Array.from(childAddresses.keys());
                  } else {
                    address = filter.address as Address | Address[] | undefined;
                  }

                  return withPullClock(
                    eth_getLogsWithPagination(
                      params.rpc,
                      [
                        {
                          address,
                          topics: sanitizeLogTopics([
                            filter.topic0,
                            filter.topic1 ?? null,
                            filter.topic2 ?? null,
                            filter.topic3 ?? null,
                          ]),
                          fromBlock: numberToHex(factoryInterval[0]),
                          toBlock: numberToHex(factoryInterval[1]),
                        },
                      ],
                      {
                        ...context,
                        ethGetLogsBlockRange: params.chain.ethGetLogsBlockRange,
                      },
                    ),
                  ).pipe(
                    Stream.mapEffect(({ value: page, endClock }) =>
                      Effect.gen(function* () {
                        yield* Effect.logDebug(
                          {
                            msg: "Fetched block range data",
                            chain: params.chain.name,
                            chain_id: params.chain.id,
                            block_range: JSON.stringify([
                              page.fromBlock,
                              page.toBlock,
                            ]),
                            log_count: page.logs.length,
                            duration: yield* endClock,
                          },
                          ["chain", "block_range"],
                        );

                        for (const log of page.logs) {
                          if (log.transactionHash === zeroHash) {
                            yield* Effect.logWarning({
                              msg: "Detected log with empty transaction hash. This is expected for some chains like ZKsync.",
                              action: "fetch_block_data",
                              chain: params.chain.name,
                              chain_id: params.chain.id,
                              number: hexToNumber(log.blockNumber),
                              hash: log.blockHash,
                              logIndex: hexToNumber(log.logIndex),
                            });
                          }
                          const blockNumber = hexToNumber(log.blockNumber);
                          if (perBlockLogs.has(blockNumber) === false) {
                            perBlockLogs.set(blockNumber, new Map());
                          }
                          perBlockLogs
                            .get(blockNumber)!
                            .set(hexToNumber(log.logIndex), log);
                        }

                        return [
                          page.fromBlock,
                          page.toBlock,
                        ] satisfies Interval;
                      }),
                    ),
                  );
                }),
              );
            };

            for (const requiredInterval of requiredIntervals) {
              const { filter, interval } = requiredInterval;

              switch (filter.type) {
                case "block":
                case "transaction":
                case "trace":
                case "transfer":
                  // Note: `syncBlock` matches factory addresses, so it requires all
                  // child addresses up to each block.
                  intervalStreams.set(
                    requiredInterval,
                    paginateFactoryDependencies(
                      interval,
                      getFilterFactories(filter).map(({ id }) => id),
                    ),
                  );
                  break;
                case "log":
                  intervalStreams.set(
                    requiredInterval,
                    fetchLogsWithPagination(filter, interval),
                  );
              }
            }

            /**
             * Returns `true` if `blockNumber` has required data.
             */
            const isBlockRequired = (blockNumber: number) =>
              perBlockLogs.has(blockNumber) ||
              requiredIntervals.some(({ filter, interval }) => {
                if (blockNumber < interval[0] || blockNumber > interval[1]) {
                  return false;
                }

                // Note: Blocks with logs are in `perBlockLogs`.
                if (filter.type === "log") return false;
                if (filter.type === "block") {
                  return isBlockFilterMatched({
                    filter,
                    block: { number: BigInt(blockNumber) },
                  });
                }
                // Transaction, trace, and transfer filters require every block.
                return true;
              });

            const syncBlock = (
              blockNumber: number,
            ): Effect.Effect<BlockData, Error> =>
              Effect.gen(function* () {
                const filters = requiredIntervals
                  .filter(
                    ({ interval }) =>
                      interval[0] <= blockNumber && blockNumber <= interval[1],
                  )
                  .map(({ filter }) => filter);
                const blockFilters = filters.filter(
                  (filter): filter is Extract<Filter, { type: "block" }> =>
                    filter.type === "block",
                );
                const transactionFilters = filters.filter(
                  (
                    filter,
                  ): filter is Extract<Filter, { type: "transaction" }> =>
                    filter.type === "transaction",
                );
                const traceFilters = filters.filter(
                  (filter): filter is Extract<Filter, { type: "trace" }> =>
                    filter.type === "trace",
                );
                const transferFilters = filters.filter(
                  (filter): filter is Extract<Filter, { type: "transfer" }> =>
                    filter.type === "transfer",
                );
                const logFilters = filters.filter(
                  (filter): filter is Extract<Filter, { type: "log" }> =>
                    filter.type === "log",
                );

                // Note: `perBlockLogs` is keyed by log index.
                const blockLogs = perBlockLogs.has(blockNumber)
                  ? Array.from(perBlockLogs.get(blockNumber)!.entries())
                      .sort(([a], [b]) => a - b)
                      .map(([, log]) => log)
                  : undefined;
                perBlockLogs.delete(blockNumber);

                const shouldRequestTraces =
                  traceFilters.some((filter) =>
                    isBlockInFilter(filter, blockNumber),
                  ) ||
                  transferFilters.some((filter) =>
                    isBlockInFilter(filter, blockNumber),
                  );

                const endClock = yield* startClockEffect;
                let block: SyncBlock | undefined;

                const requiredTransactions = new Set<Hash>();
                const requiredTransactionReceipts = new Set<Hash>();

                ////////
                // Logs
                ////////

                let logs: SyncLog[] = [];
                if (blockLogs !== undefined) {
                  block = yield* eth_getBlockByNumber(
                    params.rpc,
                    [numberToHex(blockNumber), true],
                    context,
                  );

                  logs = blockLogs.filter((log) => {
                    let isMatched = false;

                    for (const filter of logFilters) {
                      if (
                        isLogFilterMatched({ filter, log }) &&
                        (isAddressFactory(filter.address)
                          ? isAddressMatched({
                              address: log.address,
                              blockNumber,
                              childAddresses: params.childAddress.get(
                                filter.address.id,
                              )!,
                            })
                          : true)
                      ) {
                        isMatched = true;

                        if (log.transactionHash !== zeroHash) {
                          requiredTransactions.add(log.transactionHash);
                          if (filter.hasTransactionReceipt) {
                            requiredTransactionReceipts.add(
                              log.transactionHash,
                            );

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
                    yield* validateLogsAndBlock(
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

                let traces: SyncTrace[] = [];
                if (shouldRequestTraces) {
                  if (block === undefined) {
                    [block, traces] = yield* Effect.all(
                      [
                        eth_getBlockByNumber(
                          params.rpc,
                          [numberToHex(blockNumber), true],
                          context,
                        ),
                        debug_traceBlockByNumber(
                          params.rpc,
                          [numberToHex(blockNumber), { tracer: "callTracer" }],
                          context,
                        ),
                      ],
                      { concurrency: "unbounded" },
                    );
                  } else {
                    traces = yield* debug_traceBlockByNumber(
                      params.rpc,
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
                              childAddresses: params.childAddress.get(
                                filter.fromAddress.id,
                              )!,
                            })
                          : true) &&
                        (isAddressFactory(filter.toAddress)
                          ? isAddressMatched({
                              address: trace.trace.to,
                              blockNumber,
                              childAddresses: params.childAddress.get(
                                filter.toAddress.id,
                              )!,
                            })
                          : true)
                      ) {
                        isMatched = true;
                        requiredTransactions.add(trace.transactionHash);
                        if (filter.hasTransactionReceipt) {
                          requiredTransactionReceipts.add(
                            trace.transactionHash,
                          );
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
                              childAddresses: params.childAddress.get(
                                filter.fromAddress.id,
                              )!,
                            })
                          : true) &&
                        (isAddressFactory(filter.toAddress)
                          ? isAddressMatched({
                              address: trace.trace.to,
                              blockNumber,
                              childAddresses: params.childAddress.get(
                                filter.toAddress.id,
                              )!,
                            })
                          : true)
                      ) {
                        isMatched = true;
                        requiredTransactions.add(trace.transactionHash);
                        if (filter.hasTransactionReceipt) {
                          requiredTransactionReceipts.add(
                            trace.transactionHash,
                          );
                          // skip to next trace
                          break;
                        }
                      }
                    }

                    return isMatched;
                  });

                  if (traces.length > 0) {
                    yield* validateTracesAndBlock(
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
                  block = yield* eth_getBlockByNumber(
                    params.rpc,
                    [numberToHex(blockNumber), true],
                    context,
                  );
                }

                ////////
                // Transactions
                ////////

                if (block === undefined) {
                  block = yield* eth_getBlockByNumber(
                    params.rpc,
                    [numberToHex(blockNumber), true],
                    context,
                  );
                }

                const transactions = block.transactions.filter(
                  (transaction) => {
                    let isMatched = requiredTransactions.has(transaction.hash);
                    for (const filter of transactionFilters) {
                      if (
                        isTransactionFilterMatched({ filter, transaction }) &&
                        (isAddressFactory(filter.fromAddress)
                          ? isAddressMatched({
                              address: transaction.from,
                              blockNumber,
                              childAddresses: params.childAddress.get(
                                filter.fromAddress.id,
                              )!,
                            })
                          : true) &&
                        (isAddressFactory(filter.toAddress)
                          ? isAddressMatched({
                              address: transaction.to ?? undefined,
                              blockNumber,
                              childAddresses: params.childAddress.get(
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
                  },
                );

                if (transactions.length > 0) {
                  yield* validateTransactionsAndBlock(block, {
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

                const receiptResponses = yield* eth_getTransactionReceipts(
                  params.rpc,
                  {
                    blockHash: block.hash,
                    transactionHashes: requiredTransactionReceipts,
                  },
                  context,
                );
                for (const { receipts, request } of receiptResponses) {
                  yield* validateReceiptsAndBlock(receipts, block, request, {
                    method: "eth_getBlockByNumber",
                    params: [block.number, true],
                  });
                }
                const transactionReceipts = receiptResponses.flatMap(
                  ({ receipts }) =>
                    receipts.filter((receipt) =>
                      requiredTransactionReceipts.has(receipt.transactionHash),
                    ),
                );

                yield* Effect.logDebug(
                  {
                    msg: "Fetched block data",
                    chain: params.chain.name,
                    chain_id: params.chain.id,
                    block: blockNumber,
                    transaction_count: transactions.length,
                    receipt_count: transactionReceipts.length,
                    trace_count: traces.length,
                    duration: yield* endClock,
                  },
                  ["chain", "block"],
                );

                return {
                  blocks: [syncBlockToInternal({ block })],
                  logs: logs.map((log) => syncLogToInternal({ log })),
                  transactions: transactions.map((transaction) =>
                    syncTransactionToInternal({ transaction }),
                  ),
                  transactionReceipts: transactionReceipts.map(
                    (transactionReceipt) =>
                      syncTransactionReceiptToInternal({ transactionReceipt }),
                  ),
                  traces: traces.map((trace) =>
                    syncTraceToInternal({
                      trace,
                      block: block!,
                      transaction: transactionsByHash.get(
                        trace.transactionHash,
                      )!,
                    }),
                  ),
                  cursor: blockNumber,
                };
              });

            const MAX_BLOCKS_IN_MEM = 100;

            /**
             * Blocks that are fetched, but not yet emitted, in order. At most
             * `MAX_BLOCKS_IN_MEM` blocks are fetched ahead of the consumer.
             */
            const pendingBlockData: Fiber.Fiber<BlockData, Error>[] = [];

            return mergeIntervalStreams(intervalStreams).pipe(
              Stream.flatMap((interval) =>
                Stream.range(interval[0], interval[1]),
              ),
              Stream.filter(isBlockRequired),
              Stream.mapEffect((blockNumber) =>
                Effect.gen(function* () {
                  // Note: Start fetching the block right away, so that requests are sent
                  // in block order. A failed block fails the stream when it's emitted.
                  const fiber = yield* Effect.forkIn(
                    syncBlock(blockNumber),
                    scope,
                    { startImmediately: true },
                  );
                  pendingBlockData.push(fiber);

                  if (pendingBlockData.length < MAX_BLOCKS_IN_MEM) return [];
                  return [yield* Fiber.join(pendingBlockData.shift()!)];
                }),
              ),
              Stream.flattenIterable,
              Stream.concat(
                Stream.suspend(() =>
                  Stream.fromIterable(pendingBlockData),
                ).pipe(Stream.mapEffect(Fiber.join)),
              ),
              // Note: Fetch all child addresses, even those after the last required block.
              // Realtime sync requires them, e.g. when the contract `startBlock` is after the
              // finalized block but the factory `startBlock` is not.
              Stream.concat(
                Stream.fromEffectDrain(
                  Effect.forEach(
                    factoryPages.values(),
                    (nextPage) =>
                      Effect.repeat(nextPage, {
                        until: (toBlock) =>
                          toBlock === Number.POSITIVE_INFINITY,
                      }),
                    { discard: true },
                  ),
                ),
              ),
            );
          }),
        ),
    };

    return historicalSync;
  });

/**
 * Pair each element of `stream` with a clock that starts when the element is
 * pulled, so that durations don't include the time that the consumer takes.
 */
const withPullClock = <A, E>(
  stream: Stream.Stream<A, E>,
): Stream.Stream<{ value: A; endClock: Effect.Effect<number> }, E> =>
  Stream.transformPull(stream, (pull) =>
    Effect.succeed(
      Effect.gen(function* () {
        const endClock = yield* startClockEffect;
        const values = yield* pull;
        return Arr.map(values, (value) => ({ value, endClock }));
      }),
    ),
  );

/**
 * Merge the intervals that each filter has fetched into intervals that all
 * filters have fetched.
 *
 * Note: Each stream is pulled one interval at a time. The streams at the end of
 * a merged interval are pulled while the consumer processes it.
 */
export const mergeIntervalStreams = <E>(
  filterStreams: Map<{ interval: Interval }, Stream.Stream<Interval, E>>,
): Stream.Stream<Interval, E> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const scope = yield* Effect.scope;
      const pulls = yield* Effect.forEach(filterStreams.values(), (stream) =>
        Stream.toPull(Stream.rechunk(stream, 1)),
      );

      /** Pull the next interval of stream `index`, or `undefined` once it's done. */
      const next = (index: number) =>
        pulls[index]!.pipe(
          Effect.map(([interval]): Interval | undefined => interval),
          Pull.catchDone(() => Effect.succeed(undefined)),
        );

      const results = yield* Effect.forEach(pulls, (_, index) => next(index), {
        concurrency: "unbounded",
      });

      /** Pulls of the streams at the end of the last merged interval. */
      let resultsFiber: Fiber.Fiber<void, E> | undefined;

      return Stream.paginate<number, Interval, E>(
        Math.min(
          ...Array.from(filterStreams.keys()).map(
            ({ interval }) => interval[0],
          ),
        ),
        (cursor) =>
          Effect.gen(function* () {
            if (resultsFiber !== undefined) {
              yield* Fiber.join(resultsFiber);
            }

            if (results.every((result) => result === undefined)) {
              return [[], Option.none()] as const;
            }

            const supremum = Math.min(
              ...results
                .filter((result): result is Interval => result !== undefined)
                .map((result) => result[1]),
            );

            const minIndices = Array.from(results.entries())
              .filter(([, result]) => result?.[1] === supremum)
              .map(([index]) => index);

            resultsFiber = yield* Effect.forkIn(
              Effect.gen(function* () {
                const nextResults = yield* Effect.forEach(minIndices, next, {
                  concurrency: "unbounded",
                });
                for (const [index, result] of nextResults.entries()) {
                  results[minIndices[index]!] = result;
                }
              }),
              scope,
              { startImmediately: true },
            );

            if (cursor > supremum) return [[], Option.some(cursor)] as const;
            return [
              [[cursor, supremum] satisfies Interval],
              Option.some(supremum + 1),
            ] as const;
          }),
      );
    }),
  );
