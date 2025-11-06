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
  _debug_traceBlockByNumber,
  _eth_getBlockByNumber,
  _eth_getBlockReceipts,
  _eth_getLogs,
  _eth_getTransactionReceipt,
  validateLogsAndBlock,
  validateReceiptsAndBlock,
  validateTracesAndBlock,
  validateTransactionsAndBlock,
} from "@/rpc/actions.js";
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
import type {
  ChildAddresses,
  IntervalWithFactory,
  IntervalWithFilter,
} from "@/runtime/index.js";
import type { SyncStore } from "@/sync-store/index.js";
import {
  type Interval,
  getChunks,
  intervalBounds,
  intervalRange,
} from "@/utils/interval.js";
import { promiseAllSettledWithThrow } from "@/utils/promiseAllSettledWithThrow.js";
import { createQueue } from "@/utils/queue.js";
import { startClock } from "@/utils/timer.js";
import { getLogsRetryHelper } from "@ponder/utils";
import {
  type Address,
  type Hash,
  type Hex,
  type LogTopic,
  type RpcError,
  hexToNumber,
  toHex,
  zeroHash,
} from "viem";

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

  type EthGetLogsParams = {
    address: Address | Address[] | undefined;
    topic0?: LogTopic;
    topic1?: LogTopic;
    topic2?: LogTopic;
    topic3?: LogTopic;
    interval: Interval;
  };

  /**
   * Split "eth_getLogs" requests into ranges inferred from errors
   * and batch requests.
   */
  const syncLogsDynamic = async (
    { address, topic0, topic1, topic2, topic3, interval }: EthGetLogsParams,
    context?: Parameters<Rpc["request"]>[1],
  ): Promise<SyncLog[]> => {
    // Use the recommended range if available, else don't chunk the interval at all.
    const intervals = getChunks({
      interval,
      maxChunkSize:
        logsRequestMetadata.confirmedRange ??
        logsRequestMetadata.estimatedRange,
    });

    const topics = [
      topic0 ?? null,
      topic1 ?? null,
      topic2 ?? null,
      topic3 ?? null,
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
          _eth_getLogs(
            args.rpc,
            {
              address,
              topics,
              fromBlock: interval[0],
              toBlock: interval[1],
            },
            context,
          ).catch((error) => {
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
              { address, topic0, topic1, topic2, topic3, interval },
              context,
            );
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
    context?: Parameters<Rpc["request"]>[1],
  ): Promise<SyncTransactionReceipt[]> => {
    if (transactionHashes.size === 0) {
      return [];
    }

    if (isBlockReceipts === false) {
      const transactionReceipts = await Promise.all(
        Array.from(transactionHashes).map((hash) =>
          _eth_getTransactionReceipt(args.rpc, { hash }, context),
        ),
      );

      validateReceiptsAndBlock(
        transactionReceipts,
        block,
        "eth_getTransactionReceipt",
        "number",
      );

      return transactionReceipts;
    }

    let blockReceipts: SyncTransactionReceipt[];
    try {
      blockReceipts = await _eth_getBlockReceipts(
        args.rpc,
        { blockHash: block.hash },
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
      "eth_getBlockReceipts",
      "number",
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
        topic0: factory.eventSelector,
        interval,
      },
      context,
    );

    const childAddresses = new Map<Address, number>();
    const childAddressesRecord = args.childAddresses.get(factory.id)!;

    for (const log of logs) {
      if (isLogFactoryMatched({ factory, log })) {
        const address = getChildAddress({ log, factory });
        const existingBlockNumber = childAddressesRecord.get(address);
        const newBlockNumber = hexToNumber(log.blockNumber);

        if (
          existingBlockNumber === undefined ||
          existingBlockNumber > newBlockNumber
        ) {
          childAddresses.set(address, newBlockNumber);
          childAddressesRecord.set(address, newBlockNumber);
        }
      }
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
      const logs: SyncLog[] = [];

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

      const mergedEthGetLogsParams: Map<string, EthGetLogsParams> = new Map();
      const singleEthGetLogsParams: EthGetLogsParams[] = [];

      for (const { filter, interval } of requiredIntervals) {
        if (filter.type !== "log") continue;

        const hasAddress = filter.address !== undefined;
        const hasTopic1 = filter.topic1 !== undefined;
        const hasTopic2 = filter.topic2 !== undefined;
        const hasTopic3 = filter.topic3 !== undefined;

        if (hasAddress === false || hasTopic1 || hasTopic2 || hasTopic3) {
          if (isAddressFactory(filter.address)) {
            const childAddresses = args.childAddresses.get(filter.address.id)!;
            singleEthGetLogsParams.push({
              address:
                childAddresses.size >=
                args.common.options.factoryAddressCountThreshold
                  ? undefined
                  : Array.from(childAddresses.keys()),
              topic0: filter.topic0,
              topic1: filter.topic1,
              topic2: filter.topic2,
              topic3: filter.topic3,
              interval,
            });
          } else {
            singleEthGetLogsParams.push({
              address: filter.address,
              topic0: filter.topic0,
              topic1: filter.topic1,
              topic2: filter.topic2,
              topic3: filter.topic3,
              interval,
            });
          }

          continue;
        }

        let addressKey: string;
        if (isAddressFactory(filter.address)) {
          addressKey = filter.address.id;
        } else if (Array.isArray(filter.address)) {
          addressKey = filter.address.join("_");
        } else {
          addressKey = filter.address as Address;
        }

        if (mergedEthGetLogsParams.has(addressKey) === false) {
          if (isAddressFactory(filter.address)) {
            const childAddresses = args.childAddresses.get(filter.address.id)!;
            mergedEthGetLogsParams.set(addressKey, {
              address:
                childAddresses.size >=
                args.common.options.factoryAddressCountThreshold
                  ? undefined
                  : Array.from(childAddresses.keys()),
              topic0: filter.topic0,
              topic1: filter.topic1,
              topic2: filter.topic2,
              topic3: filter.topic3,
              interval,
            });
          } else {
            mergedEthGetLogsParams.set(addressKey, {
              address: filter.address,
              topic0: filter.topic0,
              topic1: filter.topic1,
              topic2: filter.topic2,
              topic3: filter.topic3,
              interval,
            });
          }
        } else {
          const existingInterval =
            mergedEthGetLogsParams.get(addressKey)!.interval;
          const existingTopic0 = mergedEthGetLogsParams.get(addressKey)!
            .topic0 as Hex | Hex[];

          mergedEthGetLogsParams.get(addressKey)!.topic0 = [
            ...(Array.isArray(existingTopic0)
              ? existingTopic0
              : [existingTopic0]),
            filter.topic0,
          ];
          mergedEthGetLogsParams.get(addressKey)!.interval = intervalBounds([
            existingInterval,
            interval,
          ]);
        }
      }

      const ethGetLogsParams = [
        ...singleEthGetLogsParams,
        ...Array.from(mergedEthGetLogsParams.values()),
      ];

      await Promise.all(
        ethGetLogsParams.map(async (params) => {
          const _logs = await syncLogsDynamic(params, context);
          logs.push(..._logs);
        }),
      );

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
          block = await _eth_getBlockByNumber(
            args.rpc,
            { blockNumber },
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

                requiredTransactions.add(log.transactionHash);
                if (filter.hasTransactionReceipt) {
                  requiredTransactionReceipts.add(log.transactionHash);

                  // skip to next log
                  break;
                }
              }
            }

            return isMatched;
          });

          if (logs.length > 0) {
            validateLogsAndBlock(logs, block!, "number");
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
              _eth_getBlockByNumber(args.rpc, { blockNumber }, context),
              _debug_traceBlockByNumber(args.rpc, { blockNumber }, context),
            ]);
          } else {
            traces = await _debug_traceBlockByNumber(
              args.rpc,
              { blockNumber },
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
            validateTracesAndBlock(traces, block, "number");
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
          block = await _eth_getBlockByNumber(
            args.rpc,
            { blockNumber },
            context,
          );
        }

        ////////
        // Transactions
        ////////

        // Return early if no data is fetched
        if (block === undefined && transactionFilters.length === 0) {
          return;
        }

        if (block === undefined) {
          block = await _eth_getBlockByNumber(
            args.rpc,
            { blockNumber },
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
          validateTransactionsAndBlock(block, "number");
        }

        // Free memory of all unused transactions
        block.transactions = transactions;

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

      const queue = createQueue({
        browser: false,
        initialStart: true,
        concurrency: MAX_BLOCKS_IN_MEM,
        worker: syncBlockData,
      });

      await Promise.all(intervalRange(interval).map(queue.add));

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
