import { Deferred, Effect, Result, Stream } from "effect";
import {
  type Address,
  type Hash,
  type Hex,
  hexToBytes,
  hexToNumber,
  numberToHex,
  zeroHash,
} from "viem";
import type {
  BlockFilter,
  Chain,
  EventCallback,
  Factory,
  FactoryFragmentId,
  FactoryId,
  Filter,
  LightBlock,
  LogFilter,
  SyncBlock,
  SyncBlockHeader,
  SyncLog,
  SyncTrace,
  SyncTransaction,
  SyncTransactionReceipt,
  TraceFilter,
  TransactionFilter,
  TransferFilter,
} from "@/internal/types.js";
import {
  debug_traceBlockByHash,
  eth_getBlockByHash,
  eth_getBlockByNumber,
  eth_getLogs,
  eth_getTransactionReceipts,
  validateLogsAndBlock,
  validateReceiptsAndBlock,
  validateTracesAndBlock,
  validateTransactionsAndBlock,
} from "@/rpc/actions.js";
import type { Rpc } from "@/rpc/index.js";
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
  mergeLogFiltersToBlockRequest,
} from "@/runtime/filter.js";
import {
  getFactoryFragmentId,
  getFactoryFragmentIds,
} from "@/runtime/fragments.js";
import type { SyncProgress } from "@/runtime/index.js";
import { isAsyncExecutionChain } from "@/utils/finality.js";
import { range } from "@/utils/range.js";
import { startClockEffect } from "@/utils/timer.js";
import {
  getFactoryBloom,
  getLogFilterBloom,
  isFactoryInBloom,
  isFilterInBloom,
  isInBloom,
  zeroLogsBloom,
} from "./bloom.js";

/** A new block of the remote chain. */
export type Head = {
  block: SyncBlock | SyncBlockHeader;
  /**
   * Completed with `false` if the block is rejected. Otherwise, the `"block"`
   * event carries it, for the consumer to complete.
   */
  isAccepted?: Deferred.Deferred<boolean>;
};

export type RealtimeSync = {
  /**
   * Fetch block event data for each head and reconcile it into the local
   * chain, one head at a time.
   *
   * A failed head or poll (a failure in `heads`) is logged and skipped. Once
   * the retry budget is exhausted, the stream fails with the error.
   *
   * @dev The stream is pulled one event at a time, so the local chain is
   * updated after the consumer handles each event.
   */
  events<E, R>(
    heads: Stream.Stream<Result.Result<Head, Error>, E, R>,
  ): Stream.Stream<RealtimeSyncEvent, Error | E, R>;
};

export type BlockWithEventData = {
  block: SyncBlock | SyncBlockHeader;
  transactions: SyncTransaction[];
  transactionReceipts: SyncTransactionReceipt[];
  logs: SyncLog[];
  traces: SyncTrace[];
  /** Child addresses found in the block per `factory_log` fragment ID. */
  childAddresses: Map<FactoryFragmentId, Set<Address>>;
};

export type RealtimeSyncEvent =
  | ({
      type: "block";
      hasMatchedFilter: boolean;
      isAccepted?: Deferred.Deferred<boolean>;
    } & BlockWithEventData)
  | { type: "finalize"; block: LightBlock }
  | { type: "reorg"; block: LightBlock; reorgedBlocks: LightBlock[] };

type CreateRealtimeSyncParameters = {
  chain: Chain;
  rpc: Rpc;
  eventCallbacks: EventCallback[];
  syncProgress: Pick<SyncProgress, "finalized">;
  childAddresses: Map<FactoryId, Map<Address, number>>;
};

const MAX_LATEST_BLOCK_ATTEMPT_MS = 10 * 60 * 1000; // 10 minutes
const MAX_QUEUED_BLOCKS = 50;
/**
 * Retries of a block that a lagging provider doesn't have yet, for about 2
 * seconds. A block that no provider has, such as a reorged block, fails after
 * them, instead of blocking the chain for the retries of an error.
 */
const NULL_BLOCK_RETRY_COUNT = 4;

export const createRealtimeSync = (
  args: CreateRealtimeSyncParameters,
): Effect.Effect<RealtimeSync> =>
  Effect.gen(function* () {
    let finalizedBlock: LightBlock = args.syncProgress.finalized;
    const childAddresses = args.childAddresses;
    /** Annotates `childAddresses` for efficient lookup by block number */
    const childAddressesPerBlock = new Map<
      number,
      BlockWithEventData["childAddresses"]
    >();
    /**
     * Blocks that have been ingested and are
     * waiting to be finalized. It is an invariant that
     * all blocks are linked to each other,
     * `parentHash` => `hash`.
     */
    let unfinalizedBlocks: LightBlock[] = [];

    const factories: Factory[] = [];
    const factoryIds = new Set<FactoryId>();
    const factoryFragmentIds = new Map<Factory, FactoryFragmentId[]>();
    const logFilters: LogFilter[] = [];
    const traceFilters: TraceFilter[] = [];
    const transactionFilters: TransactionFilter[] = [];
    const transferFilters: TransferFilter[] = [];
    const blockFilters: BlockFilter[] = [];

    for (const eventCallback of args.eventCallbacks) {
      if (
        eventCallback.filter.toBlock &&
        eventCallback.filter.toBlock <= hexToNumber(finalizedBlock.number)
      ) {
        continue;
      }

      // Collect filters from event callbacks
      if (eventCallback.filter.type === "log") {
        logFilters.push(eventCallback.filter);
      } else if (eventCallback.filter.type === "trace") {
        traceFilters.push(eventCallback.filter);
      } else if (eventCallback.filter.type === "transaction") {
        transactionFilters.push(eventCallback.filter);
      } else if (eventCallback.filter.type === "transfer") {
        transferFilters.push(eventCallback.filter);
      } else if (eventCallback.filter.type === "block") {
        blockFilters.push(eventCallback.filter);
      }

      for (const factory of getFilterFactories(eventCallback.filter)) {
        if (
          factory.toBlock &&
          factory.toBlock <= hexToNumber(finalizedBlock.number)
        ) {
          continue;
        }

        if (factoryIds.has(factory.id)) continue;
        factoryIds.add(factory.id);
        factories.push(factory);
        factoryFragmentIds.set(factory, getFactoryFragmentIds(factory));
      }
    }

    const logFilterBlooms = logFilters.map(getLogFilterBloom);
    const factoryBlooms = factories.map(getFactoryBloom);

    const getLatestUnfinalizedBlock = () => {
      if (unfinalizedBlocks.length === 0) {
        return finalizedBlock;
      } else return unfinalizedBlocks[unfinalizedBlocks.length - 1]!;
    };

    /**
     * Fetch all data (logs, traces, receipts) for the specified block required by `args.sources`
     *
     * @dev The data returned by this function may include false positives. This
     * is due to the fact that factory addresses are unknown and are always
     * treated as "matched".
     */
    const fetchBlockEventData = (
      maybeBlockHeader: SyncBlock | SyncBlockHeader,
    ): Effect.Effect<BlockWithEventData, Error> =>
      Effect.gen(function* () {
        // Note: A provider that lags behind the one that reported the block
        // returns null, and the request is retried.
        const context = {
          logAnnotations: { action: "fetch_block_data" },
          retryNullBlockRequest: true,
          nullBlockRetryCount: NULL_BLOCK_RETRY_COUNT,
        };
        const endClock = yield* startClockEffect;

        let block: SyncBlock | undefined;
        let ethGetBlockMethod: "eth_getBlockByHash" | "eth_getBlockByNumber";

        if (maybeBlockHeader.transactions !== undefined) {
          block = maybeBlockHeader;
          ethGetBlockMethod = "eth_getBlockByNumber";
        } else {
          ethGetBlockMethod = "eth_getBlockByHash";
        }

        ////////
        // Logs
        ////////

        // Async-execution chains cannot reliably use blooms to filter or validate logs.
        // A zero `logsBloom` is treated as missing.
        const isAsyncExecution = isAsyncExecutionChain(args.chain.id);
        const blockNumber = hexToNumber(maybeBlockHeader.number);
        const bloom = hexToBytes(maybeBlockHeader.logsBloom);

        const logsRequestFilter = mergeLogFiltersToBlockRequest({
          logFilters: logFilters.filter(
            (logFilter, i) =>
              isBlockInFilter(logFilter, blockNumber) &&
              (isAsyncExecution ||
                maybeBlockHeader.logsBloom === zeroLogsBloom ||
                isFilterInBloom({ bloom, filter: logFilterBlooms[i]! })),
          ),
          factories: factories.filter(
            (factory, i) =>
              isBlockInFilter(factory, blockNumber) &&
              (isAsyncExecution ||
                maybeBlockHeader.logsBloom === zeroLogsBloom ||
                isFactoryInBloom({ bloom, factory: factoryBlooms[i]! })),
          ),
        });
        const shouldRequestLogs = logsRequestFilter !== undefined;

        let logs: SyncLog[] = [];
        if (shouldRequestLogs) {
          const logsRequestParams = {
            blockHash: maybeBlockHeader.hash,
            address: logsRequestFilter.address,
            topics: logsRequestFilter.topics,
          };

          if (block === undefined) {
            [block, logs] = yield* Effect.all(
              [
                eth_getBlockByHash(
                  args.rpc,
                  [maybeBlockHeader.hash, true],
                  context,
                ),
                eth_getLogs(args.rpc, [logsRequestParams], context),
              ],
              { concurrency: "unbounded" },
            );
          } else {
            logs = yield* eth_getLogs(args.rpc, [logsRequestParams], context);
          }

          yield* validateLogsAndBlock(
            logs,
            block,
            {
              method: "eth_getLogs",
              params: [logsRequestParams],
            },
            ethGetBlockMethod === "eth_getBlockByNumber"
              ? {
                  method: "eth_getBlockByNumber",
                  params: [block.number, true],
                }
              : {
                  method: "eth_getBlockByHash",
                  params: [block.hash, true],
                },
          );

          for (const log of logs) {
            if (log.transactionHash === zeroHash) {
              yield* Effect.logWarning({
                msg: "Detected log with empty transaction hash. This is expected for some chains like ZKsync.",
                action: "fetch_block_data",
                chain: args.chain.name,
                chain_id: args.chain.id,
                number: hexToNumber(block.number),
                hash: block.hash,
                logIndex: hexToNumber(log.logIndex),
              });
            }
          }
        }

        if (
          shouldRequestLogs === false &&
          (logFilters.length > 0 || factories.length > 0)
        ) {
          yield* Effect.logTrace({
            msg: "Skipped eth_getLogs request due to bloom filter result",
            action: "fetch_block_data",
            chain: args.chain.name,
            chain_id: args.chain.id,
            number: hexToNumber(maybeBlockHeader.number),
            hash: maybeBlockHeader.hash,
          });
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
            [block, traces] = yield* Effect.all(
              [
                eth_getBlockByHash(
                  args.rpc,
                  [maybeBlockHeader.hash, true],
                  context,
                ),
                debug_traceBlockByHash(
                  args.rpc,
                  [maybeBlockHeader.hash, { tracer: "callTracer" }],
                  context,
                ),
              ],
              { concurrency: "unbounded" },
            );
          } else {
            traces = yield* debug_traceBlockByHash(
              args.rpc,
              [block.hash, { tracer: "callTracer" }],
              context,
            );
          }

          yield* validateTracesAndBlock(
            traces,
            block,
            {
              method: "debug_traceBlockByNumber",
              params: [block.number, { tracer: "callTracer" }],
            },
            ethGetBlockMethod === "eth_getBlockByNumber"
              ? {
                  method: "eth_getBlockByNumber",
                  params: [block.number, true],
                }
              : {
                  method: "eth_getBlockByHash",
                  params: [block.hash, true],
                },
          );
        }

        ////////
        // Get Matched
        ////////

        // Record `blockChildAddresses` that contain factory child addresses
        const blockChildAddresses: BlockWithEventData["childAddresses"] =
          new Map();
        const factoryLogs = new Set<SyncLog>();

        const childAddressDecodeFailureIds = new Set<string>();
        let childAddressDecodeFailureCount = 0;
        let childAddressDecodeSuccessCount = 0;

        for (const factory of factories) {
          for (const log of logs) {
            if (isLogFactoryMatched({ factory, log })) {
              factoryLogs.add(log);
              let address: Address;
              try {
                address = getChildAddress({ log, factory });
                childAddressDecodeSuccessCount++;
              } catch (error) {
                if (factory.address === undefined) {
                  childAddressDecodeFailureCount++;
                  if (childAddressDecodeFailureIds.has(factory.id) === false) {
                    childAddressDecodeFailureIds.add(factory.id);
                    yield* Effect.logDebug({
                      msg: "Failed to extract child address from log matched by factory using the provided ABI item",
                      chain: args.chain.name,
                      chain_id: args.chain.id,
                      factory: factory.sourceId,
                      block_number: hexToNumber(log.blockNumber),
                      log_index: hexToNumber(log.logIndex),
                      data: log.data,
                      topics: JSON.stringify(log.topics),
                    });
                  }
                  continue;
                } else {
                  return yield* Effect.fail(error as Error);
                }
              }
              const fragmentId = getFactoryFragmentId(factory, log.address);
              if (blockChildAddresses.has(fragmentId) === false) {
                blockChildAddresses.set(fragmentId, new Set());
              }
              blockChildAddresses.get(fragmentId)!.add(address);
            }
          }
        }

        if (childAddressDecodeFailureCount > 0) {
          yield* Effect.logDebug({
            msg: "Logs matched by factory contained child addresses that could not be extracted",
            failure_count: childAddressDecodeFailureCount,
            success_count: childAddressDecodeSuccessCount,
          });
        }

        const requiredTransactions = new Set<Hash>();
        const requiredTransactionReceipts = new Set<Hash>();

        // Remove logs that don't match a filter, recording required transactions
        logs = logs.filter((log) => {
          let isMatched = false;

          for (const filter of logFilters) {
            if (isLogFilterMatched({ filter, log })) {
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

        if (isAsyncExecution === false && block !== undefined) {
          // Note: Exact `logsBloom` validations were considered too strict to add to `validateLogsAndBlock`.
          const logsBloom = hexToBytes(block.logsBloom);
          const checkedInputs = new Set<Hex>();
          let isInvalidLogsBloom = false;
          for (const log of [...factoryLogs, ...logs]) {
            if (
              checkedInputs.has(log.address) === false &&
              isInBloom(logsBloom, log.address) === false
            ) {
              isInvalidLogsBloom = true;
            }

            if (
              log.topics[0] &&
              checkedInputs.has(log.topics[0]) === false &&
              isInBloom(logsBloom, log.topics[0]) === false
            ) {
              isInvalidLogsBloom = true;
            }

            if (
              log.topics[1] &&
              checkedInputs.has(log.topics[1]) === false &&
              isInBloom(logsBloom, log.topics[1]) === false
            ) {
              isInvalidLogsBloom = true;
            }

            if (
              log.topics[2] &&
              checkedInputs.has(log.topics[2]) === false &&
              isInBloom(logsBloom, log.topics[2]) === false
            ) {
              isInvalidLogsBloom = true;
            }

            if (
              log.topics[3] &&
              checkedInputs.has(log.topics[3]) === false &&
              isInBloom(logsBloom, log.topics[3]) === false
            ) {
              isInvalidLogsBloom = true;
            }

            if (isInvalidLogsBloom) {
              yield* Effect.logWarning({
                msg: "Detected inconsistent RPC responses. Log not found in block.logsBloom.",
                action: "fetch_block_data",
                chain: args.chain.name,
                chain_id: args.chain.id,
                number: hexToNumber(block.number),
                hash: block.hash,
                logIndex: hexToNumber(log.logIndex),
              });
              break;
            }

            checkedInputs.add(log.address);
            for (const topic of log.topics) checkedInputs.add(topic);
          }
        }

        // Initial weak trace filtering before full filtering with factory addresses in handleBlock
        traces = traces.filter((trace) => {
          let isMatched = false;
          for (const filter of transferFilters) {
            if (
              isTransferFilterMatched({
                filter,
                trace: trace.trace,
                block: maybeBlockHeader,
              })
            ) {
              requiredTransactions.add(trace.transactionHash);
              isMatched = true;
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
                block: maybeBlockHeader,
              })
            ) {
              requiredTransactions.add(trace.transactionHash);
              isMatched = true;
              if (filter.hasTransactionReceipt) {
                requiredTransactionReceipts.add(trace.transactionHash);
                // skip to next trace
                break;
              }
            }
          }

          return isMatched;
        });

        ////////
        // Transactions
        ////////

        const blockTransactionFilters = transactionFilters.filter((filter) =>
          isBlockInFilter(filter, blockNumber),
        );

        // exit early if no logs or traces were requested and no transactions are required
        if (block === undefined && blockTransactionFilters.length === 0) {
          yield* Effect.logDebug(
            {
              msg: "Fetched block data",
              chain: args.chain.name,
              chain_id: args.chain.id,
              number: hexToNumber(maybeBlockHeader.number),
              hash: maybeBlockHeader.hash,
              transaction_count: 0,
              receipt_count: 0,
              trace_count: 0,
              log_count: 0,
              child_address_count: 0,
              duration: yield* endClock,
            },
            ["chain", "number", "hash"],
          );

          return {
            block: maybeBlockHeader,
            transactions: [],
            transactionReceipts: [],
            logs: [],
            traces: [],
            childAddresses: blockChildAddresses,
          };
        }

        if (block === undefined) {
          block = yield* eth_getBlockByHash(
            args.rpc,
            [maybeBlockHeader.hash, true],
            context,
          );
        }
        yield* validateTransactionsAndBlock(
          block,
          ethGetBlockMethod === "eth_getBlockByNumber"
            ? {
                method: "eth_getBlockByNumber",
                params: [block.number, true],
              }
            : {
                method: "eth_getBlockByHash",
                params: [block.hash, true],
              },
        );

        const transactions = block.transactions.filter((transaction) => {
          let isMatched = requiredTransactions.has(transaction.hash);
          for (const filter of blockTransactionFilters) {
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

        const receiptResponses = yield* eth_getTransactionReceipts(
          args.rpc,
          {
            blockHash: block.hash,
            transactionHashes: requiredTransactionReceipts,
          },
          context,
        );
        for (const { receipts, request } of receiptResponses) {
          yield* validateReceiptsAndBlock(
            receipts,
            block,
            request,
            ethGetBlockMethod === "eth_getBlockByNumber"
              ? {
                  method: "eth_getBlockByNumber",
                  params: [block.number, true],
                }
              : { method: "eth_getBlockByHash", params: [block.hash, true] },
          );
        }
        const transactionReceipts = receiptResponses.flatMap(({ receipts }) =>
          receipts.filter((receipt) =>
            requiredTransactionReceipts.has(receipt.transactionHash),
          ),
        );

        let childAddressCount = 0;
        for (const childAddresses of blockChildAddresses.values()) {
          childAddressCount += childAddresses.size;
        }

        yield* Effect.logDebug(
          {
            msg: "Fetched block data",
            chain: args.chain.name,
            chain_id: args.chain.id,
            number: hexToNumber(block.number),
            hash: block.hash,
            transaction_count: transactions.length,
            log_count: logs.length,
            trace_count: traces.length,
            receipt_count: transactionReceipts.length,
            child_address_count: childAddressCount,
            duration: yield* endClock,
          },
          ["chain", "number", "hash"],
        );

        return {
          block,
          transactions,
          transactionReceipts,
          logs,
          traces,
          childAddresses: blockChildAddresses,
        };
      });

    /**
     * Filter the block event data using the filters and child addresses.
     */
    const filterBlockEventData = ({
      block,
      logs,
      traces,
      transactions,
      transactionReceipts,
      childAddresses: blockChildAddresses,
    }: BlockWithEventData): BlockWithEventData & {
      matchedFilters: Set<Filter>;
    } => {
      // Update `childAddresses`
      if (blockChildAddresses.size > 0) {
        for (const factory of factories) {
          const knownAddresses = childAddresses.get(factory.id)!;
          for (const fragmentId of factoryFragmentIds.get(factory)!) {
            const blockAddresses = blockChildAddresses.get(fragmentId);
            if (blockAddresses === undefined) continue;
            for (const address of blockAddresses) {
              if (knownAddresses.has(address) === false) {
                knownAddresses.set(address, hexToNumber(block.number));
              }
            }
          }
        }
      }

      // Save per block child addresses so that they can be undone in the event of a reorg.
      childAddressesPerBlock.set(
        hexToNumber(block.number),
        blockChildAddresses,
      );

      /**
       * `logs` and `callTraces` must be filtered again (already filtered in `extract`)
       *  because `extract` doesn't have factory address information.
       */

      const matchedFilters = new Set<Filter>();

      // Remove logs that don't match a filter, accounting for factory addresses
      logs = logs.filter((log) => {
        let isMatched = false;

        for (const filter of logFilters) {
          if (
            isLogFilterMatched({ filter, log }) &&
            (isAddressFactory(filter.address)
              ? isAddressMatched({
                  address: log.address,
                  blockNumber: hexToNumber(block.number),
                  childAddresses: childAddresses.get(filter.address.id)!,
                })
              : true)
          ) {
            matchedFilters.add(filter);
            isMatched = true;
          }
        }

        return isMatched;
      });

      traces = traces.filter((trace) => {
        let isMatched = false;
        for (const filter of transferFilters) {
          if (
            isTransferFilterMatched({
              filter,
              trace: trace.trace,
              block,
            }) &&
            (isAddressFactory(filter.fromAddress)
              ? isAddressMatched({
                  address: trace.trace.from,
                  blockNumber: hexToNumber(block.number),
                  childAddresses: childAddresses.get(filter.fromAddress.id)!,
                })
              : true) &&
            (isAddressFactory(filter.toAddress)
              ? isAddressMatched({
                  address: trace.trace.to,
                  blockNumber: hexToNumber(block.number),
                  childAddresses: childAddresses.get(filter.toAddress.id)!,
                })
              : true)
          ) {
            matchedFilters.add(filter);
            isMatched = true;
          }
        }

        for (const filter of traceFilters) {
          if (
            isTraceFilterMatched({
              filter,
              trace: trace.trace,
              block,
            }) &&
            (isAddressFactory(filter.fromAddress)
              ? isAddressMatched({
                  address: trace.trace.from,
                  blockNumber: hexToNumber(block.number),
                  childAddresses: childAddresses.get(filter.fromAddress.id)!,
                })
              : true) &&
            (isAddressFactory(filter.toAddress)
              ? isAddressMatched({
                  address: trace.trace.to,
                  blockNumber: hexToNumber(block.number),
                  childAddresses: childAddresses.get(filter.toAddress.id)!,
                })
              : true)
          ) {
            matchedFilters.add(filter);
            isMatched = true;
          }
        }

        return isMatched;
      });

      // Remove transactions and transaction receipts that may have been filtered out

      const transactionHashes = new Set<Hash>();
      for (const log of logs) {
        transactionHashes.add(log.transactionHash);
      }
      for (const trace of traces) {
        transactionHashes.add(trace.transactionHash);
      }

      transactions = transactions.filter((transaction) => {
        let isMatched = transactionHashes.has(transaction.hash);
        for (const filter of transactionFilters) {
          if (
            isTransactionFilterMatched({ filter, transaction }) &&
            (isAddressFactory(filter.fromAddress)
              ? isAddressMatched({
                  address: transaction.from,
                  blockNumber: hexToNumber(block.number),
                  childAddresses: childAddresses.get(filter.fromAddress.id)!,
                })
              : true) &&
            (isAddressFactory(filter.toAddress)
              ? isAddressMatched({
                  address: transaction.to ?? undefined,
                  blockNumber: hexToNumber(block.number),
                  childAddresses: childAddresses.get(filter.toAddress.id)!,
                })
              : true)
          ) {
            matchedFilters.add(filter);
            isMatched = true;
          }
        }
        return isMatched;
      });

      for (const transaction of transactions) {
        transactionHashes.add(transaction.hash);
      }

      transactionReceipts = transactionReceipts.filter((t) =>
        transactionHashes.has(t.transactionHash),
      );

      // Record matched block filters
      for (const filter of blockFilters) {
        if (isBlockFilterMatched({ filter, block })) {
          matchedFilters.add(filter);
        }
      }

      return {
        matchedFilters,
        block,
        logs,
        transactions,
        transactionReceipts,
        traces,
        childAddresses: blockChildAddresses,
      };
    };

    /**
     * Traverse the remote chain until we find a block that is
     * compatible with our local chain.
     *
     * @param block Block that caused reorg to be detected.
     * Must be at most 1 block ahead of the local chain.
     */
    const reconcileReorg = (
      block: SyncBlock | SyncBlockHeader,
    ): Effect.Effect<Extract<RealtimeSyncEvent, { type: "reorg" }>, Error> =>
      Effect.gen(function* () {
        const context = {
          logAnnotations: { action: "reconcile_reorg" },
          retryNullBlockRequest: true,
          nullBlockRetryCount: NULL_BLOCK_RETRY_COUNT,
        };
        const endClock = yield* startClockEffect;

        yield* Effect.logDebug({
          msg: "Detected reorg in local chain",
          chain: args.chain.name,
          chain_id: args.chain.id,
          number: hexToNumber(block.number),
          hash: block.hash,
        });

        // Note: The local chain must not be mutated until the common ancestor is found.
        // If an RPC request fails mid-walk, the local chain must be unchanged so that the
        // next attempt to reconcile the reorg includes all of the reorged blocks.

        // Record blocks that have been removed from the local chain.
        const reorgedBlocks = unfinalizedBlocks.filter(
          (lb) => hexToNumber(lb.number) >= hexToNumber(block.number),
        );

        // Local chain with the reorged blocks pruned
        const localChain = unfinalizedBlocks.filter(
          (lb) => hexToNumber(lb.number) < hexToNumber(block.number),
        );

        // Block we are attempting to fit into the local chain.
        let remoteBlock: LightBlock = block;

        while (true) {
          const parentBlock =
            localChain.length === 0
              ? finalizedBlock
              : localChain[localChain.length - 1]!;

          if (parentBlock.hash === remoteBlock.parentHash) break;

          if (localChain.length === 0) {
            // No compatible block was found in the local chain, must be a deep reorg.

            yield* Effect.logWarning({
              msg: "Encountered unrecoverable reorg",
              chain: args.chain.name,
              chain_id: args.chain.id,
              finalized_block: hexToNumber(finalizedBlock.number),
              duration: yield* endClock,
            });

            return yield* Effect.fail(
              new Error(
                `Encountered unrecoverable '${args.chain.name}' reorg beyond finalized block ${hexToNumber(finalizedBlock.number)}`,
              ),
            );
          } else {
            remoteBlock = yield* eth_getBlockByHash(
              args.rpc,
              [remoteBlock.parentHash, false],
              context,
            );
            // Add tip to `reorgedBlocks`
            reorgedBlocks.unshift(localChain.pop()!);
          }
        }

        // Prune the local chain of blocks that have been reorged out
        unfinalizedBlocks = localChain;

        const commonAncestor = getLatestUnfinalizedBlock();

        yield* Effect.logDebug({
          msg: "Reconciled reorg in local chain",
          chain: args.chain.name,
          chain_id: args.chain.id,
          reorg_depth: reorgedBlocks.length,
          common_ancestor_block: hexToNumber(commonAncestor.number),
          duration: yield* endClock,
        });

        // remove reorged blocks from `childAddresses`
        for (const block of reorgedBlocks) {
          const blockNumber = hexToNumber(block.number);
          const blockChildAddresses = childAddressesPerBlock.get(blockNumber)!;
          for (const factory of factories) {
            const knownAddresses = childAddresses.get(factory.id)!;
            for (const fragmentId of factoryFragmentIds.get(factory)!) {
              const blockAddresses = blockChildAddresses.get(fragmentId);
              if (blockAddresses === undefined) continue;
              for (const address of blockAddresses) {
                if (knownAddresses.get(address) === blockNumber) {
                  knownAddresses.delete(address);
                }
              }
            }
          }
          childAddressesPerBlock.delete(blockNumber);
        }

        return {
          type: "reorg",
          block: commonAncestor,
          reorgedBlocks,
        };
      });

    /**
     * Finish syncing a block.
     *
     * The four cases are:
     * 1) Block is the same as the one just processed, no-op.
     * 2) Block is behind the last processed. This is a sign that
     *    a reorg has occurred.
     * 3) Block is more than one ahead of the last processed,
     *    fetch all intermediate blocks and enqueue them again.
     * 4) Block is exactly one block ahead of the last processed,
     *    handle this new block (happy path).
     *
     * @dev `isAccepted` is guaranteed to be completed with `false` or carried by a `"block"`
     * event exactly once, or the stream fails.
     * @dev It is an invariant that the correct events are generated or the stream fails.
     * @dev The stream is pulled one event at a time, so the local chain is updated
     * after the consumer handles each event.
     */
    const reconcileBlock = (
      blockWithEventData: BlockWithEventData,
      isAccepted?: Deferred.Deferred<boolean>,
    ): Stream.Stream<RealtimeSyncEvent, Error> =>
      Stream.unwrap(
        Effect.gen(function* () {
          const endClock = yield* startClockEffect;

          const latestBlock = getLatestUnfinalizedBlock();
          const block = blockWithEventData.block;

          // We already saw and handled this block. No-op.
          if (latestBlock.hash === block.hash) {
            yield* Effect.logTrace({
              msg: "Detected duplicate block",
              chain: args.chain.name,
              chain_id: args.chain.id,
              number: hexToNumber(block.number),
              hash: block.hash,
            });

            if (isAccepted) yield* Deferred.succeed(isAccepted, false);
            return Stream.empty;
          }

          // An RPC that lags behind can report a block that is already in the
          // local chain or older than the finalized block. No-op.
          if (
            hexToNumber(block.number) <= hexToNumber(finalizedBlock.number) ||
            unfinalizedBlocks.some((b) => b.hash === block.hash)
          ) {
            yield* Effect.logTrace({
              msg: "Detected stale block",
              chain: args.chain.name,
              chain_id: args.chain.id,
              number: hexToNumber(block.number),
              hash: block.hash,
            });

            if (isAccepted) yield* Deferred.succeed(isAccepted, false);
            return Stream.empty;
          }

          // Quickly check for a reorg by comparing block numbers. If the block
          // number has not increased, a reorg must have occurred.
          if (hexToNumber(latestBlock.number) >= hexToNumber(block.number)) {
            const reorgEvent = yield* reconcileReorg(block);

            if (isAccepted) yield* Deferred.succeed(isAccepted, false);
            return Stream.succeed(reorgEvent);
          }

          // Blocks are missing. They should be fetched and enqueued.
          if (hexToNumber(latestBlock.number) + 1 < hexToNumber(block.number)) {
            yield* Effect.logTrace({
              msg: "Missing blocks from local chain",
              chain: args.chain.name,
              chain_id: args.chain.id,
              block_range: JSON.stringify([
                hexToNumber(latestBlock.number) + 1,
                hexToNumber(block.number) - 1,
              ]),
            });

            // Retrieve missing blocks, but only fetch a certain amount.
            const missingBlockRange = range(
              hexToNumber(latestBlock.number) + 1,
              Math.min(
                hexToNumber(block.number),
                hexToNumber(latestBlock.number) + MAX_QUEUED_BLOCKS,
              ),
            );

            const pendingBlocks = yield* Effect.forEach(
              missingBlockRange,
              (blockNumber) =>
                eth_getBlockByNumber(
                  args.rpc,
                  [numberToHex(blockNumber), true],
                  {
                    logAnnotations: { action: "fetch_missing_blocks" },
                    retryNullBlockRequest: true,
                  },
                ).pipe(Effect.flatMap(fetchBlockEventData)),
              { concurrency: "unbounded" },
            );

            yield* Effect.logDebug({
              msg: "Fetched missing blocks",
              chain: args.chain.name,
              chain_id: args.chain.id,
              block_range: JSON.stringify([
                hexToNumber(latestBlock.number) + 1,
                Math.min(
                  hexToNumber(block.number) - 1,
                  hexToNumber(latestBlock.number) + MAX_QUEUED_BLOCKS,
                ),
              ]),
            });

            return Stream.fromIterable(pendingBlocks).pipe(
              Stream.flatMap((pendingBlock) => reconcileBlock(pendingBlock)),
              Stream.concat(
                Stream.unwrap(
                  Effect.gen(function* () {
                    if (
                      hexToNumber(block.number) -
                        hexToNumber(latestBlock.number) >
                      MAX_QUEUED_BLOCKS
                    ) {
                      yield* Effect.logTrace({
                        msg: "Latest block too far ahead of local chain",
                        chain: args.chain.name,
                        chain_id: args.chain.id,
                        number: hexToNumber(block.number),
                        hash: block.hash,
                      });

                      if (isAccepted) {
                        yield* Deferred.succeed(isAccepted, false);
                      }
                      return Stream.empty;
                    }

                    return reconcileBlock(blockWithEventData, isAccepted);
                  }),
                ),
              ),
            );
          }

          // Check if a reorg occurred by validating the chain of block hashes.
          if (block.parentHash !== latestBlock.hash) {
            const reorgEvent = yield* reconcileReorg(block);

            if (isAccepted) yield* Deferred.succeed(isAccepted, false);
            return Stream.succeed(reorgEvent);
          }

          // New block is exactly one block ahead of the local chain.
          // Attempt to ingest it.

          const blockWithFilteredEventData =
            filterBlockEventData(blockWithEventData);

          let childAddressCount = 0;
          for (const childAddresses of blockWithFilteredEventData.childAddresses.values()) {
            childAddressCount += childAddresses.size;
          }

          yield* Effect.logDebug(
            {
              msg: "Added block to local chain",
              chain: args.chain.name,
              chain_id: args.chain.id,
              number: hexToNumber(block.number),
              hash: block.hash,
              transaction_count: blockWithFilteredEventData.transactions.length,
              log_count: blockWithFilteredEventData.logs.length,
              trace_count: blockWithFilteredEventData.traces.length,
              receipt_count:
                blockWithFilteredEventData.transactionReceipts.length,
              child_address_count: childAddressCount,
              duration: yield* endClock,
            },
            ["chain", "number", "hash"],
          );

          unfinalizedBlocks.push({
            hash: block.hash,
            parentHash: block.parentHash,
            number: block.number,
            timestamp: block.timestamp,
          });

          // Make sure `transactions` can be garbage collected
          blockWithEventData.block.transactions =
            blockWithFilteredEventData.transactions;

          const blockEvent: RealtimeSyncEvent = {
            type: "block",
            hasMatchedFilter:
              blockWithFilteredEventData.matchedFilters.size > 0,
            block: blockWithFilteredEventData.block,
            logs: blockWithFilteredEventData.logs,
            transactions: blockWithFilteredEventData.transactions,
            transactionReceipts: blockWithFilteredEventData.transactionReceipts,
            traces: blockWithFilteredEventData.traces,
            childAddresses: blockWithFilteredEventData.childAddresses,
            isAccepted,
          };

          return Stream.succeed(blockEvent).pipe(
            Stream.concat(
              Stream.unwrap(
                Effect.gen(function* () {
                  // Finalize the oldest contiguous blocks that are outside the timestamp
                  // based reorg window.
                  const blockMovesFinality =
                    hexToNumber(block.timestamp) -
                      hexToNumber(unfinalizedBlocks[0]!.timestamp) >=
                    args.chain.reorgWindow;
                  if (blockMovesFinality === false) return Stream.empty;

                  let pendingFinalizedBlock = unfinalizedBlocks[0]!;
                  for (const candidate of unfinalizedBlocks) {
                    if (
                      hexToNumber(block.timestamp) -
                        hexToNumber(candidate.timestamp) >=
                      args.chain.reorgWindow
                    ) {
                      pendingFinalizedBlock = candidate;
                    } else {
                      break;
                    }
                  }

                  yield* Effect.logDebug({
                    msg: "Removed finalized blocks from local chain",
                    chain: args.chain.name,
                    chain_id: args.chain.id,
                    block_count:
                      hexToNumber(pendingFinalizedBlock.number) -
                      hexToNumber(finalizedBlock.number),
                    block_range: JSON.stringify([
                      hexToNumber(finalizedBlock.number) + 1,
                      hexToNumber(pendingFinalizedBlock.number),
                    ]),
                  });

                  const finalizedBlocks = unfinalizedBlocks.filter(
                    (lb) =>
                      hexToNumber(lb.number) <=
                      hexToNumber(pendingFinalizedBlock.number),
                  );

                  unfinalizedBlocks = unfinalizedBlocks.filter(
                    (lb) =>
                      hexToNumber(lb.number) >
                      hexToNumber(pendingFinalizedBlock.number),
                  );

                  for (const block of finalizedBlocks) {
                    childAddressesPerBlock.delete(hexToNumber(block.number));
                  }

                  finalizedBlock = pendingFinalizedBlock;

                  return Stream.succeed<RealtimeSyncEvent>({
                    type: "finalize",
                    block: pendingFinalizedBlock,
                  });
                }),
              ),
            ),
          );
        }),
      );

    const realtimeSync: RealtimeSync = {
      events: (heads) =>
        Stream.suspend(() => {
          let errorCount = 0;

          /**
           * Log a failed head (or, without `block`, a failed poll). Fails with
           * `error` once the retry budget is exhausted.
           */
          const onFailure = (
            error: Error,
            block?: SyncBlock | SyncBlockHeader,
          ): Effect.Effect<void, Error> =>
            Effect.gen(function* () {
              yield* Effect.logWarning({
                msg: "Failed to fetch latest block",
                chain: args.chain.name,
                chain_id: args.chain.id,
                ...(block
                  ? { number: hexToNumber(block.number), hash: block.hash }
                  : {}),
                retry_count: errorCount,
                error,
              });

              errorCount += 1;

              // Number of retries is max(10, `MAX_LATEST_BLOCK_ATTEMPT_MS` / `args.chain.pollingInterval`)
              if (
                errorCount >= 10 &&
                errorCount * args.chain.pollingInterval >
                  MAX_LATEST_BLOCK_ATTEMPT_MS
              ) {
                return yield* Effect.fail(error);
              }
            });

          const reconcileHead = ({
            block,
            isAccepted,
          }: Head): Stream.Stream<RealtimeSyncEvent, Error> =>
            Stream.unwrap(
              Effect.gen(function* () {
                yield* Effect.logDebug({
                  msg: "Received new head block",
                  chain: args.chain.name,
                  chain_id: args.chain.id,
                  number: hexToNumber(block.number),
                  hash: block.hash,
                });

                // We already saw and handled this block. No-op.
                if (getLatestUnfinalizedBlock().hash === block.hash) {
                  yield* Effect.logTrace({
                    msg: "Detected duplicate block",
                    chain: args.chain.name,
                    chain_id: args.chain.id,
                    number: hexToNumber(block.number),
                    hash: block.hash,
                  });
                  if (isAccepted) yield* Deferred.succeed(isAccepted, false);

                  return Stream.empty;
                }

                const blockWithEventData = yield* fetchBlockEventData(block);

                return reconcileBlock(blockWithEventData, isAccepted).pipe(
                  Stream.concat(
                    Stream.fromEffectDrain(
                      Effect.sync(() => {
                        errorCount = 0;
                      }),
                    ),
                  ),
                );
              }),
            ).pipe(
              // Note: Errors thrown by bugs are defects. They are handled like failures.
              Stream.catchDefect((defect) => Stream.fail(defect as Error)),
              Stream.catch((error) =>
                Stream.fromEffectDrain(
                  Effect.gen(function* () {
                    if (isAccepted) yield* Deferred.succeed(isAccepted, false);
                    yield* onFailure(error, block);
                  }),
                ),
              ),
            );

          return heads.pipe(
            Stream.flatMap((head) =>
              Result.isFailure(head)
                ? Stream.fromEffectDrain(onFailure(head.failure))
                : reconcileHead(head.success),
            ),
          );
        }),
    };

    return realtimeSync;
  });
