import type { Common } from "@/internal/common.js";
import type {
  BlockFilter,
  Chain,
  Factory,
  FactoryId,
  LogFactory,
  LogFilter,
  Source,
  SyncBlock,
  SyncLog,
  SyncTrace,
  SyncTransaction,
  SyncTransactionReceipt,
  TraceFilter,
  TransactionFilter,
  TransferFilter,
} from "@/internal/types.js";
import type { Rpc } from "@/rpc/index.js";
import {
  getChildAddress,
  isAddressFactory,
  isAddressMatched,
  isBlockFilterMatched,
  isLogFactoryMatched,
  isLogFilterMatched,
  isTraceFilterMatched,
  isTransactionFilterMatched,
  isTransferFilterMatched,
} from "@/runtime/filter.js";
import { shouldGetTransactionReceipt } from "@/runtime/filter.js";
import type { CachedIntervals, IntervalWithFilter } from "@/runtime/index.js";
import type { SyncStore } from "@/sync-store/index.js";
import { type Interval, getChunks, intervalRange } from "@/utils/interval.js";
import { createQueue } from "@/utils/queue.js";
import {
  _debug_traceBlockByNumber,
  _eth_getBlockByNumber,
  _eth_getBlockReceipts,
  _eth_getLogs,
  _eth_getTransactionReceipt,
  validateLogsAndBlock,
  validateReceiptsAndBlock,
  validateTracesAndBlock,
  validateTransactionsAndBlock,
} from "@/utils/rpc.js";
import { getLogsRetryHelper } from "@ponder/utils";
import {
  type Address,
  type Hash,
  type RpcError,
  hexToNumber,
  toHex,
  zeroHash,
} from "viem";

export type HistoricalSync = {
  /**
   * Syncs logs and inserts them into the database.
   */
  sync1(params: {
    requiredIntervals: IntervalWithFilter[];
    syncStore: SyncStore;
  }): Promise<{ logs: SyncLog[] }>;
  /**
   * Syncs transactions, traces, and block.
   */
  sync2(params: {
    interval: Interval;
    logs: SyncLog[];
    requiredIntervals: IntervalWithFilter[];
    syncStore: SyncStore;
  }): Promise<void>;
};

type CreateHistoricalSyncParameters = {
  common: Common;
  chain: Chain;
  rpc: Rpc;
  sources: Source[];
  childAddresses: Map<FactoryId, Map<Address, number>>;
  cachedIntervals: CachedIntervals;
};

export const createHistoricalSync = (
  args: CreateHistoricalSyncParameters,
): HistoricalSync => {
  /**
   * Flag to fetch transaction receipts through _eth_getBlockReceipts (true) or _eth_getTransactionReceipt (false)
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

    const intervals = getChunks({
      interval,
      maxChunkSize:
        logsRequestMetadata.confirmedRange ??
        logsRequestMetadata.estimatedRange,
    });

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
          _eth_getLogs(args.rpc, {
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
                args.chain.name
              }', updating recommended range to ${range}.`,
            });

            logsRequestMetadata = {
              estimatedRange: range,
              confirmedRange: getLogsErrorResponse.isSuggestedRange
                ? range
                : undefined,
            };

            return syncLogsDynamic({ address, interval, filter });
          }),
        ),
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
  ): Promise<SyncTransactionReceipt[]> => {
    if (transactionHashes.size === 0) {
      return [];
    }

    if (isBlockReceipts === false) {
      const transactionReceipts = await Promise.all(
        Array.from(transactionHashes).map((hash) =>
          _eth_getTransactionReceipt(args.rpc, { hash }),
        ),
      );

      validateReceiptsAndBlock(
        transactionReceipts,
        block,
        "eth_getTransactionReceipt",
      );

      return transactionReceipts;
    }

    let blockReceipts: SyncTransactionReceipt[];
    try {
      blockReceipts = await _eth_getBlockReceipts(args.rpc, {
        blockHash: block.hash,
      });
    } catch (_error) {
      const error = _error as Error;
      args.common.logger.warn({
        service: "sync",
        msg: `Caught eth_getBlockReceipts error on '${
          args.chain.name
        }', switching to eth_getTransactionReceipt method.`,
        error,
      });

      isBlockReceipts = false;
      return syncTransactionReceipts(block, transactionHashes);
    }

    validateReceiptsAndBlock(blockReceipts, block, "eth_getBlockReceipts");

    const transactionReceipts = blockReceipts.filter((receipt) =>
      transactionHashes.has(receipt.transactionHash),
    );

    return transactionReceipts;
  };

  /** Extract and insert the log-based addresses that match `filter` + `interval`. */
  const syncLogFactory = async (factory: LogFactory, interval: Interval) => {
    const logs = await syncLogsDynamic({
      filter: factory,
      interval,
      address: factory.address,
    });

    const childAddresses = args.childAddresses.get(factory.id)!;
    const insertableChildAddresses = new Map<Address, number>();

    for (const log of logs) {
      if (isLogFactoryMatched({ factory, log })) {
        const address = getChildAddress({ log, factory });
        const existingBlockNumber = childAddresses.get(address);
        const newBlockNumber = hexToNumber(log.blockNumber);

        if (
          existingBlockNumber === undefined ||
          existingBlockNumber > newBlockNumber
        ) {
          childAddresses.set(address, newBlockNumber);
          insertableChildAddresses.set(address, newBlockNumber);
        }
      }
    }

    return insertableChildAddresses;
  };

  /**
   * Return all addresses that match `filter` after extracting addresses
   * that match `filter` and `interval`.
   */
  const syncAddressFactory = async (
    factory: Factory,
    interval: Interval,
    syncStore: SyncStore,
  ): Promise<Map<Address, number>> => {
    const factoryInterval: Interval = [
      Math.max(factory.fromBlock ?? 0, interval[0]),
      Math.min(factory.toBlock ?? Number.POSITIVE_INFINITY, interval[1]),
    ];

    if (factoryInterval[0] <= factoryInterval[1]) {
      const childAddress = await syncLogFactory(factory, factoryInterval);
      // Note: `factory` must refer to the same original `factory` in `filter`
      // and not be a recovered factory from `recoverFilter`.
      await syncStore.insertChildAddresses({
        factory,
        childAddresses: childAddress,
        chainId: args.chain.id,
      });
    }

    // Note: `factory` must refer to the same original `factory` in `filter`
    // and not be a recovered factory from `recoverFilter`.
    return args.childAddresses.get(factory.id)!;
  };

  return {
    async sync1({ syncStore, requiredIntervals }) {
      const logs: SyncLog[] = [];

      await Promise.all(
        requiredIntervals.map(async ({ filter, interval }) => {
          try {
            switch (filter.type) {
              case "log": {
                let _logs: SyncLog[];

                if (isAddressFactory(filter.address)) {
                  const childAddresses = await syncAddressFactory(
                    filter.address,
                    interval,
                    syncStore,
                  );

                  // Note: Exit early when only the factory needs to be synced
                  if (((filter as LogFilter).fromBlock ?? 0) > interval[1]) {
                    return;
                  }

                  _logs = await syncLogsDynamic({
                    filter: filter as LogFilter,
                    interval,
                    address:
                      childAddresses.size >=
                      args.common.options.factoryAddressCountThreshold
                        ? undefined
                        : Array.from(childAddresses.keys()),
                  });

                  _logs = _logs.filter((log) =>
                    isAddressMatched({
                      address: log.address,
                      blockNumber: hexToNumber(log.blockNumber),
                      childAddresses,
                    }),
                  );
                } else {
                  _logs = await syncLogsDynamic({
                    filter: filter as LogFilter,
                    interval,
                    address: filter.address,
                  });
                }

                await syncStore.insertLogs({
                  logs: _logs,
                  chainId: args.chain.id,
                });

                for (const log of _logs) {
                  // @ts-expect-error
                  log.data = undefined;
                }

                logs.push(..._logs);

                break;
              }
              case "transaction":
              case "trace":
              case "transfer": {
                await Promise.all([
                  isAddressFactory(filter.fromAddress)
                    ? syncAddressFactory(
                        filter.fromAddress,
                        interval,
                        syncStore,
                      )
                    : Promise.resolve(),
                  isAddressFactory(filter.toAddress)
                    ? syncAddressFactory(filter.toAddress, interval, syncStore)
                    : Promise.resolve(),
                ]);
                break;
              }
            }
          } catch (_error) {
            const error = _error as Error;

            args.common.logger.error({
              service: "sync",
              msg: `Fatal error: Unable to sync '${args.chain.name}' from ${interval[0]} to ${interval[1]}.`,
              error,
            });

            throw error;
          }
        }),
      );

      return { logs };
    },
    async sync2({ syncStore, interval, requiredIntervals, logs }) {
      const blockFilters: BlockFilter[] = [];
      const transactionFilters: TransactionFilter[] = [];
      const traceFilters: TraceFilter[] = [];
      const logFilters: LogFilter[] = [];
      const transferFilters: TransferFilter[] = [];

      for (const { filter, interval } of requiredIntervals) {
        switch (filter.type) {
          case "block": {
            blockFilters.push(filter as BlockFilter);
            break;
          }

          case "transaction": {
            if (((filter as TransactionFilter).fromBlock ?? 0) > interval[1]) {
              continue;
            }

            transactionFilters.push(filter as TransactionFilter);
            break;
          }

          case "trace": {
            if (((filter as TraceFilter).fromBlock ?? 0) > interval[1]) {
              continue;
            }

            traceFilters.push(filter as TraceFilter);
            break;
          }

          case "log": {
            if (((filter as LogFilter).fromBlock ?? 0) > interval[1]) {
              continue;
            }
            logFilters.push(filter as LogFilter);
            break;
          }

          case "transfer": {
            if (((filter as TransferFilter).fromBlock ?? 0) > interval[1]) {
              continue;
            }

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

      const syncBlock = async (blockNumber: number) => {
        let block: SyncBlock | undefined;

        const requiredTransactions = new Set<Hash>();
        const requiredTransactionReceipts = new Set<Hash>();

        ////////
        // Logs
        ////////

        if (perBlockLogs.has(blockNumber)) {
          const logs = perBlockLogs.get(blockNumber)!;

          block = await _eth_getBlockByNumber(args.rpc, { blockNumber });

          for (const log of logs) {
            validateLogsAndBlock(logs, block);

            if (log.transactionHash === zeroHash) {
              args.common.logger.warn({
                service: "sync",
                msg: `Detected '${args.chain.name}' log with empty transaction hash in block ${blockNumber} at log index ${hexToNumber(log.logIndex)}. This is expected for some chains like ZKsync.`,
              });

              continue;
            }

            for (const filter of logFilters) {
              if (isLogFilterMatched({ filter, log })) {
                requiredTransactions.add(log.transactionHash);
                if (shouldGetTransactionReceipt(filter)) {
                  requiredTransactionReceipts.add(log.transactionHash);

                  // skip to next log
                  break;
                }
              }
            }
          }
        }

        ////////
        // Traces
        ////////

        const shouldRequestTraces =
          traceFilters.length > 0 || transferFilters.length > 0;

        let traces: SyncTrace[] = [];
        if (shouldRequestTraces) {
          if (block === undefined) {
            [block, traces] = await Promise.all([
              _eth_getBlockByNumber(args.rpc, { blockNumber }),
              _debug_traceBlockByNumber(args.rpc, { blockNumber }),
            ]);
          } else {
            traces = await _debug_traceBlockByNumber(args.rpc, { blockNumber });
          }

          validateTracesAndBlock(traces, block);

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
                if (shouldGetTransactionReceipt(filter)) {
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
                if (shouldGetTransactionReceipt(filter)) {
                  requiredTransactionReceipts.add(trace.transactionHash);
                  // skip to next trace
                  break;
                }
              }
            }

            return isMatched;
          });
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
          block = await _eth_getBlockByNumber(args.rpc, { blockNumber });
        }

        ////////
        // Transactions
        ////////

        if (block === undefined && transactionFilters.length === 0) {
          return;
        }

        if (block === undefined) {
          block = await _eth_getBlockByNumber(args.rpc, { blockNumber });
        }
        validateTransactionsAndBlock(block);

        const transactions = block.transactions.filter((transaction) => {
          let isMatched = requiredTransactions.has(transaction.hash);
          for (const filter of transactionFilters) {
            if (isTransactionFilterMatched({ filter, transaction })) {
              requiredTransactions.add(transaction.hash);
              requiredTransactionReceipts.add(transaction.hash);
              isMatched = true;
            }
          }
          return isMatched;
        });

        ////////
        // Transaction Receipts
        ////////

        const transactionReceipts = await syncTransactionReceipts(
          block,
          requiredTransactionReceipts,
        );

        const transactionsByHash = new Map<Hash, SyncTransaction>();
        for (const transaction of transactions) {
          transactionsByHash.set(transaction.hash, transaction);
        }

        await Promise.all([
          syncStore.insertBlocks({
            blocks: [block],
            chainId: args.chain.id,
          }),
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
        ]);
      };

      const queue = createQueue({
        browser: false,
        concurrency: 40,
        initialStart: true,
        worker: syncBlock,
      });

      await Promise.all(intervalRange(interval).map(queue.add));
    },
  };
};
