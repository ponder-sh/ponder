import {
  type Address,
  type Hash,
  hexToNumber,
  numberToHex,
  toHex,
  zeroHash,
} from "viem";
import type { Common } from "@/internal/common.js";
import type {
  Chain,
  Factory,
  Filter,
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
import { isAsyncExecutionChain } from "@/utils/finality.js";
import { type Interval, intervalBounds } from "@/utils/interval.js";
import {
  type PromiseWithResolvers,
  promiseWithResolvers,
} from "@/utils/promiseWithResolvers.js";
import { createQueue } from "@/utils/queue.js";
import { startClock } from "@/utils/timer.js";

type BlockData = Awaited<ReturnType<SyncStore["getEventData"]>>;

export type InMemoryHistoricalSync = {
  syncBlockData(params: {
    requiredIntervals: IntervalWithFilter[];
    requiredFactoryIntervals: IntervalWithFactory[];
  }): AsyncGenerator<BlockData>;
};

export function createInMemoryHistoricalSync(params: {
  common: Common;
  chain: Chain;
  rpc: Rpc;
  childAddress: ChildAddresses;
}): InMemoryHistoricalSync {
  return {
    async *syncBlockData({ requiredIntervals, requiredFactoryIntervals }) {
      const context = {
        logger: params.common.logger.child({ action: "fetch_block_data" }),
      };

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

      const factoryProgress = new Map<
        Factory["id"],
        {
          /** Closest-to-tip block with all child addresses fetched (inclusive). */
          block: number;
          endBlock: number;
          /** Resolved each time `block` increases. */
          pwr: PromiseWithResolvers<void>;
        }
      >();

      for (const { factory, interval } of factoryIntervalsById.values()) {
        factoryProgress.set(factory.id, {
          block: interval[0] - 1,
          endBlock: interval[1],
          pwr: promiseWithResolvers<void>(),
        });
      }

      /**
       * Logs keyed by block number, then by log index.
       */
      const perBlockLogs = new Map<number, Map<number, SyncLog>>();

      const intervalGenerators = new Map<
        IntervalWithFilter | IntervalWithFactory,
        AsyncGenerator<Interval>
      >();

      for (const requiredFactoryInterval of factoryIntervalsById.values()) {
        intervalGenerators.set(
          requiredFactoryInterval,
          (async function* (): AsyncGenerator<Interval> {
            const { factory, interval } = requiredFactoryInterval;
            const progress = factoryProgress.get(factory.id)!;
            const factoryChildAddresses = params.childAddress.get(factory.id)!;

            const setProgress = (block: number) => {
              const previousPwr = progress.pwr;
              progress.block = block;
              progress.pwr = promiseWithResolvers<void>();
              previousPwr.resolve();
            };

            let endClock = startClock();
            for await (const page of eth_getLogsWithPagination(
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
            )) {
              let childAddressCount = 0;

              for (const log of page.logs) {
                if (isLogFactoryMatched({ factory, log }) === false) continue;

                let address: Address;
                try {
                  address = getChildAddress({ log, factory });
                } catch (error) {
                  if (factory.address !== undefined) throw error;
                  params.common.logger.debug({
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
                const existingBlockNumber = factoryChildAddresses.get(address);
                if (
                  existingBlockNumber === undefined ||
                  existingBlockNumber > blockNumber
                ) {
                  factoryChildAddresses.set(address, blockNumber);
                  childAddressCount++;
                }
              }

              setProgress(page.toBlock);

              params.common.logger.debug(
                {
                  msg: "Fetched block range data",
                  chain: params.chain.name,
                  chain_id: params.chain.id,
                  data_type: "factory_log",
                  block_range: JSON.stringify([page.fromBlock, page.toBlock]),
                  log_count: page.logs.length,
                  child_address_count: childAddressCount,
                  duration: endClock(),
                },
                ["chain", "data_type", "block_range"],
              );

              yield [page.fromBlock, page.toBlock];
              endClock = startClock();
            }

            setProgress(interval[1]);
          })(),
        );
      }

      /**
       * Yield the sub-intervals of `interval` for which all `factories`
       * have fetched child addresses.
       */
      async function* paginateFactoryDependencies(
        interval: Interval,
        factories: Factory["id"][],
      ): AsyncGenerator<Interval> {
        let cursor = interval[0];

        while (cursor <= interval[1]) {
          const pendingFactories = factories.filter(
            (id) =>
              factoryProgress.has(id) &&
              factoryProgress.get(id)!.block <
                factoryProgress.get(id)!.endBlock,
          );

          const progressBlock = Math.min(
            interval[1],
            ...pendingFactories.map((id) => factoryProgress.get(id)!.block),
          );

          if (cursor <= progressBlock) {
            yield [cursor, progressBlock];
            cursor = progressBlock + 1;
            continue;
          }

          await Promise.race(
            pendingFactories.map((id) => factoryProgress.get(id)!.pwr.promise),
          );
        }
      }

      for (const requiredInterval of requiredIntervals) {
        intervalGenerators.set(
          requiredInterval,
          (async function* (): AsyncGenerator<Interval> {
            const { filter, interval } = requiredInterval;

            switch (filter.type) {
              case "block":
              case "transaction":
              case "trace":
              case "transfer":
                yield interval;
                break;
              case "log": {
                const factory = isAddressFactory(filter.address)
                  ? filter.address
                  : undefined;

                for await (const factoryInterval of paginateFactoryDependencies(
                  interval,
                  factory ? [factory.id] : [],
                )) {
                  let address: Address | Address[] | undefined;
                  if (factory) {
                    const childAddresses = params.childAddress.get(factory.id)!;
                    if (childAddresses.size === 0) {
                      yield factoryInterval;
                      continue;
                    }

                    address =
                      childAddresses.size >=
                      params.common.options.factoryAddressCountThreshold
                        ? undefined
                        : Array.from(childAddresses.keys());
                  } else {
                    address = filter.address as Address | Address[] | undefined;
                  }

                  let endClock = startClock();
                  for await (const page of eth_getLogsWithPagination(
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
                  )) {
                    params.common.logger.debug(
                      {
                        msg: "Fetched block range data",
                        chain: params.chain.name,
                        chain_id: params.chain.id,
                        block_range: JSON.stringify([
                          page.fromBlock,
                          page.toBlock,
                        ]),
                        log_count: page.logs.length,
                        duration: endClock(),
                      },
                      ["chain", "block_range"],
                    );

                    for (const log of page.logs) {
                      if (log.transactionHash === zeroHash) {
                        params.common.logger.warn({
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
                    yield [page.fromBlock, page.toBlock];
                    endClock = startClock();
                  }
                }
              }
            }
          })(),
        );
      }

      const syncBlock = async (
        blockNumber: number,
      ): Promise<BlockData | undefined> => {
        const endClock = startClock();
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
          (filter): filter is Extract<Filter, { type: "transaction" }> =>
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
        let block: SyncBlock | undefined;

        const requiredTransactions = new Set<Hash>();
        const requiredTransactionReceipts = new Set<Hash>();

        ////////
        // Logs
        ////////

        const blockLogs = perBlockLogs.has(blockNumber)
          ? Array.from(perBlockLogs.get(blockNumber)!.values()).sort(
              (a, b) => hexToNumber(a.logIndex) - hexToNumber(b.logIndex),
            )
          : undefined;
        perBlockLogs.delete(blockNumber);
        let logs: SyncLog[] = [];
        if (blockLogs !== undefined) {
          block = await eth_getBlockByNumber(
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
              isAsyncExecutionChain(params.chain.id),
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
                params.rpc,
                [numberToHex(blockNumber), true],
                context,
              ),
              debug_traceBlockByNumber(
                params.rpc,
                [numberToHex(blockNumber), { tracer: "callTracer" }],
                context,
              ),
            ]);
          } else {
            traces = await debug_traceBlockByNumber(
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
            params.rpc,
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
          return undefined;
        }

        if (block === undefined) {
          block = await eth_getBlockByNumber(
            params.rpc,
            [numberToHex(blockNumber), true],
            context,
          );
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

        const receiptResponses = await eth_getTransactionReceipts(
          params.rpc,
          {
            blockHash: block.hash,
            transactionHashes: requiredTransactionReceipts,
          },
          context,
        );
        const transactionReceipts = receiptResponses.flatMap(
          ({ receipts, request }) => {
            validateReceiptsAndBlock(receipts, block, request, {
              method: "eth_getBlockByNumber",
              params: [block.number, true],
            });
            return receipts.filter((receipt) =>
              requiredTransactionReceipts.has(receipt.transactionHash),
            );
          },
        );

        params.common.logger.debug(
          {
            msg: "Fetched block data",
            chain: params.chain.name,
            chain_id: params.chain.id,
            block: blockNumber,
            transaction_count: transactions.length,
            receipt_count: transactionReceipts.length,
            trace_count: traces.length,
            duration: endClock(),
          },
          ["chain", "block"],
        );

        return {
          blocks: [syncBlockToInternal({ block })],
          logs: logs.map((log) => syncLogToInternal({ log })),
          transactions: transactions.map((transaction) =>
            syncTransactionToInternal({ transaction }),
          ),
          transactionReceipts: transactionReceipts.map((transactionReceipt) =>
            syncTransactionReceiptToInternal({ transactionReceipt }),
          ),
          traces: traces.map((trace) =>
            syncTraceToInternal({
              trace,
              block: block!,
              transaction: transactionsByHash.get(trace.transactionHash)!,
            }),
          ),
          cursor: blockNumber,
        };
      };

      const MAX_BLOCKS_IN_MEM = 100;

      const queue = createQueue({
        browser: false,
        initialStart: true,
        concurrency: MAX_BLOCKS_IN_MEM,
        worker: syncBlock,
      });

      // Note: A factory `startBlock` can be before the contract `startBlock`. Skip
      // those blocks, which only contain factory logs.
      const startBlock = Math.min(
        ...requiredIntervals.map(({ interval }) => interval[0]),
      );

      for await (const interval of mergeGeneratorIntervals(
        intervalGenerators,
      )) {
        const syncPromises: Promise<BlockData | undefined>[] = [];

        for (
          let blockNumber = Math.max(interval[0], startBlock);
          blockNumber <= interval[1];
          blockNumber++
        ) {
          syncPromises.push(queue.add(blockNumber));
        }

        for (const promise of syncPromises) {
          const result = await promise;
          if (result === undefined) continue;

          yield result;
        }
      }
    },
  };
}

export async function* mergeGeneratorIntervals(
  filterGenerators: Map<{ interval: Interval }, AsyncGenerator<Interval>>,
): AsyncGenerator<Interval> {
  const results = await Promise.all(
    Array.from(filterGenerators.values()).map((gen) => gen.next()),
  );

  let cursor = Math.min(
    ...Array.from(filterGenerators.keys()).map(({ interval }) => interval[0]),
  );

  while (results.some((res) => res.done !== true)) {
    const supremum = Math.min(
      ...results
        .map((res) => (res.done ? undefined : res.value[1]))
        .filter((x): x is number => x !== undefined),
    );

    const minIndices = Array.from(
      Array.from(results.entries())
        .map(([index, result]) => {
          if (result.done) return undefined;
          if (result.value[1] === supremum) return index;
          return undefined;
        })
        .filter((x): x is number => x !== undefined),
    );

    const resultPromise = Promise.all(
      minIndices.map((index) =>
        Array.from(filterGenerators.values())[index]!.next(),
      ),
    );
    if (cursor <= supremum!) {
      yield [cursor, supremum!];
      cursor = supremum! + 1;
    }
    const nextResults = await resultPromise;
    for (const [index, result] of nextResults.entries()) {
      results[minIndices[index]!] = result;
    }
  }
}
