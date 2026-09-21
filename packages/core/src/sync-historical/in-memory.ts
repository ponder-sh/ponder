import { type Hash, hexToNumber, numberToHex, toHex, zeroHash } from "viem";
import type { Common } from "@/internal/common.js";
import type {
  Chain,
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
  isAddressFactory,
  isAddressMatched,
  isBlockFilterMatched,
  isBlockInFilter,
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
import type { Interval } from "@/utils/interval.js";
import { createQueue } from "@/utils/queue.js";

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
    async *syncBlockData({ requiredIntervals }) {
      const context = {
        logger: params.common.logger.child({ action: "fetch_block_data" }),
      };
      // TODO(kyle) factory progress

      const perBlockLogs = new Map<number, SyncLog[]>();

      const filterGenerators = new Map<
        IntervalWithFilter,
        AsyncGenerator<Interval>
      >();

      for (const requiredInterval of requiredIntervals) {
        filterGenerators.set(
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
                for await (const page of eth_getLogsWithPagination(
                  params.rpc,
                  [
                    {
                      // TODO(kyle) narrow factory addresses once factory progress is available.
                      address: isAddressFactory(filter.address)
                        ? undefined
                        : filter.address,
                      topics: sanitizeLogTopics([
                        filter.topic0,
                        filter.topic1 ?? null,
                        filter.topic2 ?? null,
                        filter.topic3 ?? null,
                      ]),
                      fromBlock: numberToHex(interval[0]),
                      toBlock: numberToHex(interval[1]),
                    },
                  ],
                  {
                    ...context,
                    ethGetLogsBlockRange: params.chain.ethGetLogsBlockRange,
                  },
                )) {
                  for (const log of page.logs) {
                    const blockNumber = hexToNumber(log.blockNumber);
                    if (perBlockLogs.has(blockNumber) === false) {
                      perBlockLogs.set(blockNumber, []);
                    }
                    perBlockLogs.get(blockNumber)!.push(log);
                  }
                  yield [page.fromBlock, page.toBlock];
                }
              }
            }
          })(),
        );
      }

      const syncBlock = async (
        blockNumber: number,
      ): Promise<BlockData | undefined> => {
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

        const blockLogs = perBlockLogs.get(blockNumber);
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

        // TODO(kyle) dedupe logs?

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

      for await (const interval of mergeGeneratorIntervals(filterGenerators)) {
        const syncPromises: Promise<BlockData | undefined>[] = [];

        for (
          let blockNumber = interval[0];
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
  filterGenerators: Map<IntervalWithFilter, AsyncGenerator<Interval>>,
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
