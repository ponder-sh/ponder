import type { Common } from "@/internal/common.js";
import { ShutdownError } from "@/internal/errors.js";
import type {
  BlockFilter,
  Chain,
  EventCallback,
  Factory,
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
  eth_getBlockReceipts,
  eth_getLogs,
  eth_getTransactionReceipt,
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
  isLogFactoryMatched,
  isLogFilterMatched,
  isTraceFilterMatched,
  isTransactionFilterMatched,
  isTransferFilterMatched,
} from "@/runtime/filter.js";
import type { SyncProgress } from "@/runtime/index.js";
import { createLock } from "@/utils/mutex.js";
import { range } from "@/utils/range.js";
import { startClock } from "@/utils/timer.js";
import {
  type Address,
  type Hash,
  hexToNumber,
  numberToHex,
  zeroHash,
} from "viem";
import { isFilterInBloom, isInBloom, zeroLogsBloom } from "./bloom.js";

export type RealtimeSync = {
  /**
   * Fetch block event data and reconcile it into the local chain.
   *
   * @param block - The block to reconcile.
   */
  sync(
    block: SyncBlock | SyncBlockHeader,
    blockCallback?: (isAccepted: boolean) => void,
  ): AsyncGenerator<RealtimeSyncEvent>;
  onError(error: Error): void;
  /** Local chain of blocks that have not been finalized. */
  unfinalizedBlocks: LightBlock[];
};

export type BlockWithEventData = {
  block: SyncBlock | SyncBlockHeader;
  transactions: SyncTransaction[];
  transactionReceipts: SyncTransactionReceipt[];
  logs: SyncLog[];
  traces: SyncTrace[];
  childAddresses: Map<Factory, Set<Address>>;
};

export type RealtimeSyncEvent =
  | ({
      type: "block";
      hasMatchedFilter: boolean;
      blockCallback?: (isAccepted: boolean) => void;
    } & BlockWithEventData)
  | { type: "finalize"; block: LightBlock }
  | { type: "reorg"; block: LightBlock; reorgedBlocks: LightBlock[] };

type CreateRealtimeSyncParameters = {
  common: Common;
  chain: Chain;
  rpc: Rpc;
  eventCallbacks: EventCallback[];
  syncProgress: Pick<SyncProgress, "finalized">;
  childAddresses: Map<FactoryId, Map<Address, number>>;
};

const MAX_LATEST_BLOCK_ATTEMPT_MS = 10 * 60 * 1000; // 10 minutes
const MAX_QUEUED_BLOCKS = 50;

export const createRealtimeSync = (
  args: CreateRealtimeSyncParameters,
): RealtimeSync => {
  let isBlockReceipts = true;
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
  /** Closest-to-tip block that has been fetched but not yet reconciled. */
  let latestFetchedBlock: LightBlock | undefined;
  let fetchAndReconcileLatestBlockErrorCount = 0;

  const realtimeSyncLock = createLock();

  const factories: Factory[] = [];
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

      factories.push(factory);
    }
  }

  const syncTransactionReceipts = async (
    block: SyncBlock,
    transactionHashes: Set<Hash>,
    ethGetBlockMethod: "eth_getBlockByHash" | "eth_getBlockByNumber",
    context?: Parameters<Rpc["request"]>[1],
  ): Promise<SyncTransactionReceipt[]> => {
    if (transactionHashes.size === 0) {
      return [];
    }

    if (isBlockReceipts === false) {
      const transactionReceipts = await Promise.all(
        Array.from(transactionHashes).map(async (hash) => {
          const receipt = await eth_getTransactionReceipt(
            args.rpc,
            [hash],
            context,
          );

          validateReceiptsAndBlock(
            [receipt],
            block,
            {
              method: "eth_getTransactionReceipt",
              params: [hash],
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

          return receipt;
        }),
      );

      return transactionReceipts;
    }

    let blockReceipts: SyncTransactionReceipt[];
    try {
      blockReceipts = await eth_getBlockReceipts(
        args.rpc,
        [block.hash],
        context,
      );
    } catch (_error) {
      const error = _error as Error;
      args.common.logger.warn({
        msg: "Caught eth_getBlockReceipts error, switching to eth_getTransactionReceipt method",
        action: "fetch block data",
        chain: args.chain.name,
        chain_id: args.chain.id,
        error,
      });

      isBlockReceipts = false;
      return syncTransactionReceipts(
        block,
        transactionHashes,
        ethGetBlockMethod,
        context,
      );
    }

    validateReceiptsAndBlock(
      blockReceipts,
      block,
      {
        method: "eth_getBlockReceipts",
        params: [block.hash],
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

    const transactionReceipts = blockReceipts.filter((receipt) =>
      transactionHashes.has(receipt.transactionHash),
    );

    return transactionReceipts;
  };

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
  const fetchBlockEventData = async (
    maybeBlockHeader: SyncBlock | SyncBlockHeader,
  ): Promise<BlockWithEventData> => {
    const context = {
      logger: args.common.logger.child({ action: "fetch_block_data" }),
    };
    const endClock = startClock();

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

    // "eth_getLogs" calls can be skipped if no filters match `newHeadBlock.logsBloom`.
    const shouldRequestLogs =
      maybeBlockHeader.logsBloom === zeroLogsBloom ||
      logFilters.some((filter) =>
        isFilterInBloom({ block: maybeBlockHeader, filter }),
      );

    let logs: SyncLog[] = [];
    if (shouldRequestLogs) {
      if (block === undefined) {
        [block, logs] = await Promise.all([
          eth_getBlockByHash(args.rpc, [maybeBlockHeader.hash, true], context),
          eth_getLogs(
            args.rpc,
            [{ blockHash: maybeBlockHeader.hash }],
            context,
          ),
        ]);
      } else {
        logs = await eth_getLogs(
          args.rpc,
          [{ blockHash: block.hash }],
          context,
        );
      }

      validateLogsAndBlock(
        logs,
        block,
        {
          method: "eth_getLogs",
          params: [{ blockHash: block.hash }],
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

      // Note: Exact `logsBloom` validations were considered too strict to add to `validateLogsAndBlock`.
      let isInvalidLogsBloom = false;
      for (const log of logs) {
        if (isInBloom(block.logsBloom, log.address) === false) {
          isInvalidLogsBloom = true;
        }

        if (
          log.topics[0] &&
          isInBloom(block.logsBloom, log.topics[0]) === false
        ) {
          isInvalidLogsBloom = true;
        }

        if (
          log.topics[1] &&
          isInBloom(block.logsBloom, log.topics[1]) === false
        ) {
          isInvalidLogsBloom = true;
        }

        if (
          log.topics[2] &&
          isInBloom(block.logsBloom, log.topics[2]) === false
        ) {
          isInvalidLogsBloom = true;
        }

        if (
          log.topics[3] &&
          isInBloom(block.logsBloom, log.topics[3]) === false
        ) {
          isInvalidLogsBloom = true;
        }

        if (isInvalidLogsBloom) {
          args.common.logger.warn({
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
      }

      for (const log of logs) {
        if (log.transactionHash === zeroHash) {
          args.common.logger.warn({
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

    if (shouldRequestLogs === false && logFilters.length > 0) {
      args.common.logger.trace({
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
      traceFilters.length > 0 || transferFilters.length > 0;

    let traces: SyncTrace[] = [];
    if (shouldRequestTraces) {
      if (block === undefined) {
        [block, traces] = await Promise.all([
          eth_getBlockByHash(args.rpc, [maybeBlockHeader.hash, true], context),
          debug_traceBlockByHash(
            args.rpc,
            [maybeBlockHeader.hash, { tracer: "callTracer" }],
            context,
          ),
        ]);
      } else {
        traces = await debug_traceBlockByHash(
          args.rpc,
          [block.hash, { tracer: "callTracer" }],
          context,
        );
      }

      validateTracesAndBlock(
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
    const blockChildAddresses = new Map<Factory, Set<Address>>();

    const childAddressDecodeFailureIds = new Set<string>();
    let childAddressDecodeFailureCount = 0;
    let childAddressDecodeSuccessCount = 0;

    for (const factory of factories) {
      blockChildAddresses.set(factory, new Set<Address>());
      for (const log of logs) {
        if (isLogFactoryMatched({ factory, log })) {
          let address: Address;
          try {
            address = getChildAddress({ log, factory });
            childAddressDecodeSuccessCount++;
          } catch (error) {
            if (factory.address === undefined) {
              childAddressDecodeFailureCount++;
              if (childAddressDecodeFailureIds.has(factory.id) === false) {
                childAddressDecodeFailureIds.add(factory.id);
                args.common.logger.debug({
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
              throw error;
            }
          }
          blockChildAddresses.get(factory)!.add(address);
        }
      }
    }

    if (childAddressDecodeFailureCount > 0) {
      args.common.logger.debug({
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

    // exit early if no logs or traces were requested and no transactions are required
    if (block === undefined && transactionFilters.length === 0) {
      args.common.logger.debug(
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
          duration: endClock(),
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
      block = await eth_getBlockByHash(
        args.rpc,
        [maybeBlockHeader.hash, true],
        context,
      );
    }
    validateTransactionsAndBlock(
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
      ethGetBlockMethod,
      context,
    );

    let childAddressCount = 0;
    for (const childAddresses of blockChildAddresses.values()) {
      childAddressCount += childAddresses.size;
    }

    args.common.logger.debug(
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
        duration: endClock(),
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
  };

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
    for (const factory of factories) {
      const factoryId = factory.id;
      for (const address of blockChildAddresses.get(factory)!) {
        if (childAddresses.get(factoryId)!.has(address) === false) {
          childAddresses
            .get(factoryId)!
            .set(address, hexToNumber(block.number));
        } else {
          blockChildAddresses.get(factory)!.delete(address);
        }
      }
    }

    // Save per block child addresses so that they can be undone in the event of a reorg.
    childAddressesPerBlock.set(hexToNumber(block.number), blockChildAddresses);

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
  const reconcileReorg = async (
    block: SyncBlock | SyncBlockHeader,
  ): Promise<Extract<RealtimeSyncEvent, { type: "reorg" }>> => {
    const context = {
      logger: args.common.logger.child({ action: "reconcile_reorg" }),
    };
    const endClock = startClock();

    args.common.logger.debug({
      msg: "Detected reorg in local chain",
      chain: args.chain.name,
      chain_id: args.chain.id,
      number: hexToNumber(block.number),
      hash: block.hash,
    });

    // Record blocks that have been removed from the local chain.
    const reorgedBlocks = unfinalizedBlocks.filter(
      (lb) => hexToNumber(lb.number) >= hexToNumber(block.number),
    );

    // Prune the local chain of blocks that have been reorged out
    unfinalizedBlocks = unfinalizedBlocks.filter(
      (lb) => hexToNumber(lb.number) < hexToNumber(block.number),
    );

    // Block we are attempting to fit into the local chain.
    let remoteBlock: LightBlock = block;

    while (true) {
      const parentBlock = getLatestUnfinalizedBlock();

      if (parentBlock.hash === remoteBlock.parentHash) break;

      if (unfinalizedBlocks.length === 0) {
        // No compatible block was found in the local chain, must be a deep reorg.

        // Note: reorgedBlocks aren't removed from `unfinalizedBlocks` because we are "bailing"
        // from this attempt to reconcile the reorg, we need to reset the local chain state back
        // to what it was before we started.
        unfinalizedBlocks = reorgedBlocks;

        args.common.logger.warn({
          msg: "Encountered unrecoverable reorg",
          chain: args.chain.name,
          chain_id: args.chain.id,
          finalized_block: hexToNumber(finalizedBlock.number),
          duration: endClock(),
        });

        throw new Error(
          `Encountered unrecoverable '${args.chain.name}' reorg beyond finalized block ${hexToNumber(finalizedBlock.number)}`,
        );
      } else {
        remoteBlock = await eth_getBlockByHash(
          args.rpc,
          [remoteBlock.parentHash, false],
          context,
        );
        // Add tip to `reorgedBlocks`
        reorgedBlocks.unshift(unfinalizedBlocks.pop()!);
      }
    }

    const commonAncestor = getLatestUnfinalizedBlock();

    args.common.logger.debug({
      msg: "Reconciled reorg in local chain",
      chain: args.chain.name,
      chain_id: args.chain.id,
      reorg_depth: reorgedBlocks.length,
      common_ancestor_block: hexToNumber(commonAncestor.number),
      duration: endClock(),
    });

    // remove reorged blocks from `childAddresses`
    for (const block of reorgedBlocks) {
      for (const factory of factories) {
        const addresses = childAddressesPerBlock
          .get(hexToNumber(block.number))!
          .get(factory)!;
        for (const address of addresses) {
          childAddresses.get(factory.id)!.delete(address);
        }
      }
      childAddressesPerBlock.delete(hexToNumber(block.number));
    }

    return {
      type: "reorg",
      block: commonAncestor,
      reorgedBlocks,
    };
  };

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
   * @dev `blockCallback` is guaranteed to be called exactly once or an error is thrown.
   * @dev It is an invariant that the correct events are generated or an error is thrown.
   */
  const reconcileBlock = async function* (
    blockWithEventData: BlockWithEventData,
    blockCallback?: (isAccepted: boolean) => void,
  ): AsyncGenerator<RealtimeSyncEvent> {
    const endClock = startClock();

    const latestBlock = getLatestUnfinalizedBlock();
    const block = blockWithEventData.block;

    // We already saw and handled this block. No-op.
    if (latestBlock.hash === block.hash) {
      args.common.logger.trace({
        msg: "Detected duplicate block",
        chain: args.chain.name,
        chain_id: args.chain.id,
        number: hexToNumber(block.number),
        hash: block.hash,
      });

      blockCallback?.(false);
      return;
    }

    // Quickly check for a reorg by comparing block numbers. If the block
    // number has not increased, a reorg must have occurred.
    if (hexToNumber(latestBlock.number) >= hexToNumber(block.number)) {
      const reorgEvent = await reconcileReorg(block);

      blockCallback?.(false);
      yield reorgEvent;
      return;
    }

    // Blocks are missing. They should be fetched and enqueued.
    if (hexToNumber(latestBlock.number) + 1 < hexToNumber(block.number)) {
      args.common.logger.trace({
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

      const pendingBlocks = await Promise.all(
        missingBlockRange.map((blockNumber) =>
          eth_getBlockByNumber(args.rpc, [numberToHex(blockNumber), true], {
            logger: args.common.logger.child({
              action: "fetch_missing_blocks",
            }),
          }).then((block) => fetchBlockEventData(block)),
        ),
      );

      args.common.logger.debug({
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

      for (const pendingBlock of pendingBlocks) {
        yield* reconcileBlock(pendingBlock);
      }

      if (
        hexToNumber(block.number) - hexToNumber(latestBlock.number) >
        MAX_QUEUED_BLOCKS
      ) {
        args.common.logger.trace({
          msg: "Latest block too far ahead of local chain",
          chain: args.chain.name,
          chain_id: args.chain.id,
          number: hexToNumber(block.number),
          hash: block.hash,
        });

        blockCallback?.(false);
      } else {
        yield* reconcileBlock(blockWithEventData, blockCallback);
      }
      return;
    }

    // Check if a reorg occurred by validating the chain of block hashes.
    if (block.parentHash !== latestBlock.hash) {
      const reorgEvent = await reconcileReorg(block);

      blockCallback?.(false);
      yield reorgEvent;
      return;
    }

    // New block is exactly one block ahead of the local chain.
    // Attempt to ingest it.

    const blockWithFilteredEventData = filterBlockEventData(blockWithEventData);

    let childAddressCount = 0;
    for (const childAddresses of blockWithFilteredEventData.childAddresses.values()) {
      childAddressCount += childAddresses.size;
    }

    args.common.logger.debug(
      {
        msg: "Added block to local chain",
        chain: args.chain.name,
        chain_id: args.chain.id,
        number: hexToNumber(block.number),
        hash: block.hash,
        transaction_count: blockWithFilteredEventData.transactions.length,
        log_count: blockWithFilteredEventData.logs.length,
        trace_count: blockWithFilteredEventData.traces.length,
        receipt_count: blockWithFilteredEventData.transactionReceipts.length,
        child_address_count: childAddressCount,
        duration: endClock(),
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
      blockWithFilteredEventData.block.transactions;

    yield {
      type: "block",
      hasMatchedFilter: blockWithFilteredEventData.matchedFilters.size > 0,
      block: blockWithFilteredEventData.block,
      logs: blockWithFilteredEventData.logs,
      transactions: blockWithFilteredEventData.transactions,
      transactionReceipts: blockWithFilteredEventData.transactionReceipts,
      traces: blockWithFilteredEventData.traces,
      childAddresses: blockWithFilteredEventData.childAddresses,
      blockCallback,
    };

    // Determine if a new range has become finalized by evaluating if the
    // latest block number is 2 * finalityBlockCount >= finalized block number.
    // Essentially, there is a range the width of finalityBlockCount that is entirely
    // finalized.

    const blockMovesFinality =
      hexToNumber(block.number) >=
      hexToNumber(finalizedBlock.number) + 2 * args.chain.finalityBlockCount;
    if (blockMovesFinality) {
      const pendingFinalizedBlock = unfinalizedBlocks.find(
        (lb) =>
          hexToNumber(lb.number) ===
          hexToNumber(block.number) - args.chain.finalityBlockCount,
      )!;

      args.common.logger.debug({
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
          hexToNumber(lb.number) <= hexToNumber(pendingFinalizedBlock.number),
      );

      unfinalizedBlocks = unfinalizedBlocks.filter(
        (lb) =>
          hexToNumber(lb.number) > hexToNumber(pendingFinalizedBlock.number),
      );

      for (const block of finalizedBlocks) {
        childAddressesPerBlock.delete(hexToNumber(block.number));
      }

      finalizedBlock = pendingFinalizedBlock;

      yield {
        type: "finalize",
        block: pendingFinalizedBlock,
      };
    }
  };

  const onError = (error: Error, block?: SyncBlock | SyncBlockHeader) => {
    if (args.common.shutdown.isKilled) {
      throw new ShutdownError();
    }

    if (block) {
      args.common.logger.warn({
        msg: "Failed to fetch latest block",
        chain: args.chain.name,
        chain_id: args.chain.id,
        number: hexToNumber(block.number),
        hash: block.hash,
        retry_count: fetchAndReconcileLatestBlockErrorCount,
        error,
      });
    } else {
      args.common.logger.warn({
        msg: "Failed to fetch latest block",
        chain: args.chain.name,
        chain_id: args.chain.id,
        retry_count: fetchAndReconcileLatestBlockErrorCount,
        error,
      });
    }

    fetchAndReconcileLatestBlockErrorCount += 1;

    // Number of retries is max(10, `MAX_LATEST_BLOCK_ATTEMPT_MS` / `args.chain.pollingInterval`)
    if (
      fetchAndReconcileLatestBlockErrorCount >= 10 &&
      fetchAndReconcileLatestBlockErrorCount * args.chain.pollingInterval >
        MAX_LATEST_BLOCK_ATTEMPT_MS
    ) {
      throw error;
    }
  };

  return {
    async *sync(block, blockCallback) {
      try {
        args.common.logger.debug({
          msg: "Received new head block",
          chain: args.chain.name,
          chain_id: args.chain.id,
          number: hexToNumber(block.number),
          hash: block.hash,
        });

        const latestBlock = getLatestUnfinalizedBlock();

        // We already saw and handled this block. No-op.
        if (
          latestBlock.hash === block.hash ||
          latestFetchedBlock?.hash === block.hash
        ) {
          args.common.logger.trace({
            msg: "Detected duplicate block",
            chain: args.chain.name,
            chain_id: args.chain.id,
            number: hexToNumber(block.number),
            hash: block.hash,
          });
          blockCallback?.(false);

          return;
        }

        // Note: It's possible that a block with the same hash as `block` is
        // currently being fetched but hasn't been fully reconciled. `latestFetchedBlock`
        // is used to handle this case.

        latestFetchedBlock = block;

        const blockWithEventData = await fetchBlockEventData(block);

        // Note: `reconcileBlock` must be called serially.

        await realtimeSyncLock.lock();

        try {
          yield* reconcileBlock(blockWithEventData, blockCallback);
        } finally {
          realtimeSyncLock.unlock();
        }

        latestFetchedBlock = undefined;

        fetchAndReconcileLatestBlockErrorCount = 0;
      } catch (_error) {
        blockCallback?.(false);
        onError(_error as Error, block);
      }
    },
    onError,
    get unfinalizedBlocks() {
      return unfinalizedBlocks;
    },
  };
};
