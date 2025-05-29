import type { Common } from "@/internal/common.js";
import { ShutdownError } from "@/internal/errors.js";
import type {
  BlockFilter,
  Chain,
  Factory,
  Filter,
  LightBlock,
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
  shouldGetTransactionReceipt,
} from "@/sync/filter.js";
import { type SyncProgress, syncBlockToLightBlock } from "@/sync/index.js";
import { mutex } from "@/utils/mutex.js";
import { range } from "@/utils/range.js";
import {
  _debug_traceBlockByHash,
  _eth_getBlockByHash,
  _eth_getBlockByNumber,
  _eth_getBlockReceipts,
  _eth_getLogs,
  _eth_getTransactionReceipt,
} from "@/utils/rpc.js";
import { wait } from "@/utils/wait.js";
import { type Address, type Hash, hexToNumber, zeroHash } from "viem";
import { isFilterInBloom, zeroLogsBloom } from "./bloom.js";

export type RealtimeSync = {
  /**
   * Fetch block event data and reconcile it into the local chain.
   *
   * @param block - The block to reconcile.
   */
  sync(block: SyncBlock): Promise<SyncResult>;
  onError(error: Error): void;
  /**
   * Local chain of blocks that have not been finalized.
   */
  unfinalizedBlocks: LightBlock[];
  childAddresses: Map<Factory, Map<Address, number>>;
};

/**
 * @dev Each "promise" property resolves when the corresponding
 * event is fully processed.
 */
type SyncResult =
  | { type: "rejected" }
  | { type: "reorg"; reorgPromise: Promise<void> }
  | {
      type: "accepted";
      blockPromise: Promise<void>;
      finalizePromise?: Promise<void>;
    };

export type BlockWithEventData = {
  block: SyncBlock;
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
    } & BlockWithEventData)
  | {
      type: "finalize";
      block: LightBlock;
    }
  | {
      type: "reorg";
      block: LightBlock;
      reorgedBlocks: LightBlock[];
    };

type CreateRealtimeSyncParameters = {
  common: Common;
  chain: Chain;
  rpc: Rpc;
  sources: Source[];
  syncProgress: Pick<SyncProgress, "finalized">;
  initialChildAddresses: Map<Factory, Map<Address, number>>;
  /**
   * Handle a realtime sync event.
   *
   * @returns An unchained promise that resolves when the event is fully processed.
   */
  onEvent: (event: RealtimeSyncEvent) => Promise<{ promise: Promise<void> }>;
  onFatalError: (error: Error) => void;
};

const MAX_LATEST_BLOCK_ATTEMPT_MS = 3 * 60 * 1000; // 3 minutes

const ERROR_TIMEOUT = [
  1, 2, 5, 10, 30, 60, 60, 60, 60, 60, 60, 60, 60, 60,
] as const;
const MAX_QUEUED_BLOCKS = 25;

export const createRealtimeSync = (
  args: CreateRealtimeSyncParameters,
): RealtimeSync => {
  ////////
  // state
  ////////
  let isBlockReceipts = true;
  let finalizedBlock: LightBlock = args.syncProgress.finalized;
  const childAddresses = args.initialChildAddresses;
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
  let fetchAndReconcileLatestBlockErrorCount = 0;
  let reconcileBlockErrorCount = 0;

  const factories: Factory[] = [];
  const logFilters: LogFilter[] = [];
  const traceFilters: TraceFilter[] = [];
  const transactionFilters: TransactionFilter[] = [];
  const transferFilters: TransferFilter[] = [];
  const blockFilters: BlockFilter[] = [];

  for (const source of args.sources) {
    // Collect filters from sources
    if (source.type === "contract") {
      if (source.filter.type === "log") {
        logFilters.push(source.filter);
      } else if (source.filter.type === "trace") {
        traceFilters.push(source.filter);
      }
    } else if (source.type === "account") {
      if (source.filter.type === "transaction") {
        transactionFilters.push(source.filter);
      } else if (source.filter.type === "transfer") {
        transferFilters.push(source.filter);
      }
    } else if (source.type === "block") {
      blockFilters.push(source.filter);
    }

    // Collect factories from sources
    switch (source.filter.type) {
      case "trace":
      case "transaction":
      case "transfer": {
        const { fromAddress, toAddress } = source.filter;

        if (isAddressFactory(fromAddress)) {
          factories.push(fromAddress);
        }
        if (isAddressFactory(toAddress)) {
          factories.push(toAddress);
        }
        break;
      }
      case "log": {
        const { address } = source.filter;
        if (isAddressFactory(address)) {
          factories.push(address);
        }
        break;
      }
    }
  }

  const syncTransactionReceipts = async (
    blockHash: Hash,
    transactionHashes: Set<Hash>,
  ): Promise<SyncTransactionReceipt[]> => {
    if (transactionHashes.size === 0) {
      return [];
    }

    if (isBlockReceipts === false) {
      const transactionReceipts = await Promise.all(
        Array.from(transactionHashes).map(async (hash) =>
          _eth_getTransactionReceipt(args.rpc, { hash }),
        ),
      );

      return transactionReceipts;
    }

    let blockReceipts: SyncTransactionReceipt[];
    try {
      blockReceipts = await _eth_getBlockReceipts(args.rpc, {
        blockHash,
      });
    } catch (_error) {
      const error = _error as Error;
      args.common.logger.warn({
        service: "realtime",
        msg: `Caught eth_getBlockReceipts error on '${
          args.chain.name
        }', switching to eth_getTransactionReceipt method.`,
        error,
      });

      isBlockReceipts = false;
      return syncTransactionReceipts(blockHash, transactionHashes);
    }

    const blockReceiptsTransactionHashes = new Set(
      blockReceipts.map((r) => r.transactionHash),
    );
    // Validate that block transaction receipts include all required transactions
    for (const hash of Array.from(transactionHashes)) {
      if (blockReceiptsTransactionHashes.has(hash) === false) {
        throw new Error(
          `Detected inconsistent RPC responses. 'transaction.hash' ${hash} not found in eth_getBlockReceipts response for block '${blockHash}'`,
        );
      }
    }
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
    block: SyncBlock,
  ): Promise<BlockWithEventData> => {
    ////////
    // Logs
    ////////

    // "eth_getLogs" calls can be skipped if no filters match `newHeadBlock.logsBloom`.
    const shouldRequestLogs =
      block.logsBloom === zeroLogsBloom ||
      logFilters.some((filter) => isFilterInBloom({ block, filter }));

    let logs: SyncLog[] = [];
    if (shouldRequestLogs) {
      logs = await _eth_getLogs(args.rpc, { blockHash: block.hash });

      // Protect against RPCs returning empty logs. Known to happen near chain tip.
      if (block.logsBloom !== zeroLogsBloom && logs.length === 0) {
        throw new Error(
          "Detected invalid eth_getLogs response. `block.logsBloom` is not empty but zero logs were returned.",
        );
      }

      const logIds = new Set<string>();
      for (const log of logs) {
        if (log.blockHash !== block.hash) {
          throw new Error(
            `Detected invalid eth_getLogs response. 'log.blockHash' ${log.blockHash} does not match requested block hash ${block.hash}`,
          );
        }

        const id = `${log.blockHash}-${log.logIndex}`;
        if (logIds.has(id)) {
          args.common.logger.warn({
            service: "sync",
            msg: `Detected invalid eth_getLogs response. Duplicate log index ${log.logIndex} for block ${log.blockHash}.`,
          });
        } else {
          logIds.add(id);
        }

        const transaction = block.transactions.find(
          (t) => t.hash === log.transactionHash,
        );
        if (transaction === undefined) {
          if (log.transactionHash === zeroHash) {
            args.common.logger.warn({
              service: "sync",
              msg: `Detected '${args.chain.name}' log with empty transaction hash in block ${block.hash} at log index ${hexToNumber(log.logIndex)}. This is expected for some chains like ZKsync.`,
            });
          } else {
            throw new Error(
              `Detected inconsistent '${args.chain.name}' RPC responses. 'log.transactionHash' ${log.transactionHash} not found in 'block.transactions' ${block.hash}`,
            );
          }
        } else {
          if (transaction!.transactionIndex !== log.transactionIndex) {
            throw new Error(
              `Detected inconsistent '${args.chain.name}' RPC responses. 'log.transactionIndex' ${log.transactionIndex} not found in 'block.transactions' ${block.hash}`,
            );
          }
        }
      }
    }

    if (
      shouldRequestLogs === false &&
      args.sources.some((s) => s.filter.type === "log")
    ) {
      args.common.logger.debug({
        service: "realtime",
        msg: `Skipped fetching '${args.chain.name}' logs for block ${hexToNumber(block.number)} due to bloom filter result`,
      });
    }

    ////////
    // Traces
    ////////

    const shouldRequestTraces =
      traceFilters.length > 0 || transferFilters.length > 0;

    let traces: SyncTrace[] = [];
    if (shouldRequestTraces) {
      traces = await _debug_traceBlockByHash(args.rpc, {
        hash: block.hash,
      });

      // Protect against RPCs returning empty traces. Known to happen near chain tip.
      // Use the fact that any transaction produces a trace.
      if (block.transactions.length !== 0 && traces.length === 0) {
        throw new Error(
          "Detected invalid debug_traceBlock response. `block.transactions` is not empty but zero traces were returned.",
        );
      }
    }

    // Validate that each trace point to valid transaction in the block
    for (const trace of traces) {
      if (
        block.transactions.find((t) => t.hash === trace.transactionHash) ===
        undefined
      ) {
        throw new Error(
          `Detected inconsistent RPC responses. 'trace.txHash' ${trace.transactionHash} not found in 'block' ${block.hash}`,
        );
      }
    }

    ////////
    // Get Matched
    ////////

    // Record `blockChildAddresses` that contain factory child addresses
    const blockChildAddresses = new Map<Factory, Set<Address>>();
    for (const factory of factories) {
      blockChildAddresses.set(factory, new Set<Address>());
      for (const log of logs) {
        if (isLogFactoryMatched({ factory, log })) {
          const address = getChildAddress({ log, factory });
          blockChildAddresses.get(factory)!.add(address);
        }
      }
    }

    const requiredTransactions = new Set<Hash>();
    const requiredTransactionReceipts = new Set<Hash>();

    // Remove logs that don't match a filter, recording required transactions
    logs = logs.filter((log) => {
      let isMatched = false;

      for (const filter of logFilters) {
        if (isLogFilterMatched({ filter, log })) {
          isMatched = true;
          if (log.transactionHash === zeroHash) {
            args.common.logger.warn({
              service: "sync",
              msg: `Detected '${args.chain.name}' log with empty transaction hash in block ${block.hash} at log index ${hexToNumber(log.logIndex)}. This is expected for some chains like ZKsync.`,
            });
          } else {
            requiredTransactions.add(log.transactionHash);
            if (shouldGetTransactionReceipt(filter)) {
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
        if (isTransferFilterMatched({ filter, trace: trace.trace, block })) {
          requiredTransactions.add(trace.transactionHash);
          isMatched = true;
          if (shouldGetTransactionReceipt(filter)) {
            requiredTransactionReceipts.add(trace.transactionHash);
            // skip to next trace
            break;
          }
        }
      }

      for (const filter of traceFilters) {
        if (isTraceFilterMatched({ filter, trace: trace.trace, block })) {
          requiredTransactions.add(trace.transactionHash);
          isMatched = true;
          if (shouldGetTransactionReceipt(filter)) {
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

    // Validate that filtered logs/callTraces point to valid transaction in the block
    const blockTransactionsHashes = new Set(
      block.transactions.map((t) => t.hash),
    );
    for (const hash of Array.from(requiredTransactions)) {
      if (blockTransactionsHashes.has(hash) === false) {
        throw new Error(
          `Detected inconsistent RPC responses. 'transaction.hash' ${hash} not found in eth_getBlockReceipts response for block '${block.hash}'.`,
        );
      }
    }

    ////////
    // Transaction Receipts
    ////////

    const transactionReceipts = await syncTransactionReceipts(
      block.hash,
      requiredTransactionReceipts,
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
      for (const address of blockChildAddresses.get(factory)!) {
        if (childAddresses.get(factory)!.has(address) === false) {
          childAddresses.get(factory)!.set(address, hexToNumber(block.number));
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
                childAddresses: childAddresses.get(filter.address)!,
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
                childAddresses: childAddresses.get(filter.fromAddress)!,
              })
            : true) &&
          (isAddressFactory(filter.toAddress)
            ? isAddressMatched({
                address: trace.trace.to,
                blockNumber: hexToNumber(block.number),
                childAddresses: childAddresses.get(filter.toAddress)!,
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
                childAddresses: childAddresses.get(filter.fromAddress)!,
              })
            : true) &&
          (isAddressFactory(filter.toAddress)
            ? isAddressMatched({
                address: trace.trace.to,
                blockNumber: hexToNumber(block.number),
                childAddresses: childAddresses.get(filter.toAddress)!,
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
          isTransactionFilterMatched({
            filter,
            transaction,
          }) &&
          (isAddressFactory(filter.fromAddress)
            ? isAddressMatched({
                address: transaction.from,
                blockNumber: hexToNumber(block.number),
                childAddresses: childAddresses.get(filter.fromAddress)!,
              })
            : true) &&
          (isAddressFactory(filter.toAddress)
            ? isAddressMatched({
                address: transaction.to ?? undefined,
                blockNumber: hexToNumber(block.number),
                childAddresses: childAddresses.get(filter.toAddress)!,
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
  const reconcileReorg = async (block: SyncBlock) => {
    args.common.logger.warn({
      service: "realtime",
      msg: `Detected forked '${args.chain.name}' block at height ${hexToNumber(block.number)}`,
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
    let remoteBlock = block;

    while (true) {
      const parentBlock = getLatestUnfinalizedBlock();

      if (parentBlock.hash === remoteBlock.parentHash) break;

      if (unfinalizedBlocks.length === 0) {
        // No compatible block was found in the local chain, must be a deep reorg.

        // Note: reorgedBlocks aren't removed from `unfinalizedBlocks` because we are "bailing"
        // from this attempt to reconcile the reorg, we need to reset the local chain state back
        // to what it was before we started.
        unfinalizedBlocks = reorgedBlocks;

        const msg = `Encountered unrecoverable '${args.chain.name}' reorg beyond finalized block ${hexToNumber(finalizedBlock.number)}`;

        args.common.logger.warn({ service: "realtime", msg });

        throw new Error(msg);
      } else {
        remoteBlock = await _eth_getBlockByHash(args.rpc, {
          hash: remoteBlock.parentHash,
        });
        // Add tip to `reorgedBlocks`
        reorgedBlocks.unshift(unfinalizedBlocks.pop()!);
      }
    }

    const commonAncestor = getLatestUnfinalizedBlock();

    args.onEvent({ type: "reorg", block: commonAncestor, reorgedBlocks });

    args.common.logger.warn({
      service: "realtime",
      msg: `Reconciled ${reorgedBlocks.length}-block '${
        args.chain.name
      }' reorg with common ancestor block ${hexToNumber(commonAncestor.number)}`,
    });

    // remove reorged blocks from `childAddresses`
    for (const block of reorgedBlocks) {
      for (const factory of factories) {
        const addresses = childAddressesPerBlock
          .get(hexToNumber(block.number))!
          .get(factory)!;
        for (const address of addresses) {
          childAddresses.get(factory)!.delete(address);
        }
      }
      childAddressesPerBlock.delete(hexToNumber(block.number));
    }
  };

  /**
   * Start syncing the latest block.
   */
  const fetchAndReconcileLatestBlock = async (
    block: SyncBlock,
  ): Promise<SyncResult> => {
    try {
      args.common.logger.debug({
        service: "realtime",
        msg: `Received latest '${args.chain.name}' block ${hexToNumber(block.number)}`,
      });

      const latestBlock = getLatestUnfinalizedBlock();

      // We already saw and handled this block. No-op.
      if (latestBlock.hash === block.hash) {
        args.common.logger.trace({
          service: "realtime",
          msg: `Skipped processing '${args.chain.name}' block ${hexToNumber(block.number)}, already synced`,
        });

        return { type: "rejected" };
      }

      const blockWithEventData = await fetchBlockEventData(block);

      fetchAndReconcileLatestBlockErrorCount = 0;

      const result = await reconcileBlock(blockWithEventData);

      return resolvePending(result);
    } catch (_error) {
      onError(_error as Error);
      return { type: "rejected" };
    }
  };

  const resolvePending = async (
    result: Awaited<ReturnType<typeof reconcileBlock>>,
  ): Promise<SyncResult> => {
    if (result.type === "pending") {
      return result.promise.then(resolvePending);
    }

    return result;
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
   * @dev This mutex only runs one at a time, every block is
   * processed serially.
   *
   * @returns
   * - `rejected` for case 1 and 2.
   * - `reorg` for case 2 with a promise that resolves once the reorg is applied.
   * - `pending` for case 3 with a promise that resolves once the block is
   *   settled as `rejected`, `accepted`, or `reorg`.
   * - `accepted` for case 4 with promises for the "block" and "finalize" events
   *   that resolve when each event is applied.
   */
  const reconcileBlock = mutex(
    async (
      blockWithEventData: BlockWithEventData,
    ): Promise<
      SyncResult | { type: "pending"; promise: Promise<SyncResult> }
    > => {
      const latestBlock = getLatestUnfinalizedBlock();
      const block = blockWithEventData.block;

      // We already saw and handled this block. No-op.
      if (latestBlock.hash === block.hash) {
        args.common.logger.trace({
          service: "realtime",
          msg: `Skipped processing '${args.chain.name}' block ${hexToNumber(block.number)}, already synced`,
        });

        return { type: "rejected" };
      }

      try {
        // Quickly check for a reorg by comparing block numbers. If the block
        // number has not increased, a reorg must have occurred.
        if (hexToNumber(latestBlock.number) >= hexToNumber(block.number)) {
          await reconcileReorg(block);

          return { type: "rejected" };
        }

        // Blocks are missing. They should be fetched and enqueued.
        if (hexToNumber(latestBlock.number) + 1 < hexToNumber(block.number)) {
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
              _eth_getBlockByNumber(args.rpc, {
                blockNumber,
              }).then((block) => fetchBlockEventData(block)),
            ),
          );

          args.common.logger.info({
            service: "realtime",
            msg: `Fetched ${missingBlockRange.length} missing '${
              args.chain.name
            }' blocks [${hexToNumber(latestBlock.number) + 1}, ${Math.min(
              hexToNumber(block.number),
              hexToNumber(latestBlock.number) + MAX_QUEUED_BLOCKS,
            )}]`,
          });

          reconcileBlock.clear(({ resolve }) => resolve({ type: "rejected" }));
          for (const pendingBlock of pendingBlocks) {
            reconcileBlock(pendingBlock);
          }

          return {
            type: "pending",
            promise: reconcileBlock(blockWithEventData).then(resolvePending),
          };
        }

        // Check if a reorg occurred by validating the chain of block hashes.
        if (block.parentHash !== latestBlock.hash) {
          await reconcileReorg(block);
          return { type: "rejected" };
        }

        // New block is exactly one block ahead of the local chain.
        // Attempt to ingest it.

        const blockWithFilteredEventData =
          filterBlockEventData(blockWithEventData);

        if (
          blockWithFilteredEventData.logs.length > 0 ||
          blockWithFilteredEventData.traces.length > 0 ||
          blockWithFilteredEventData.transactions.length > 0
        ) {
          const _text: string[] = [];

          if (blockWithFilteredEventData.logs.length === 1) {
            _text.push("1 log");
          } else if (blockWithFilteredEventData.logs.length > 1) {
            _text.push(`${blockWithFilteredEventData.logs.length} logs`);
          }

          if (blockWithFilteredEventData.traces.length === 1) {
            _text.push("1 trace");
          } else if (blockWithFilteredEventData.traces.length > 1) {
            _text.push(`${blockWithFilteredEventData.traces.length} traces`);
          }

          if (blockWithFilteredEventData.transactions.length === 1) {
            _text.push("1 transaction");
          } else if (blockWithFilteredEventData.transactions.length > 1) {
            _text.push(
              `${blockWithFilteredEventData.transactions.length} transactions`,
            );
          }

          const text = _text.filter((t) => t !== undefined).join(" and ");
          args.common.logger.info({
            service: "realtime",
            msg: `Synced ${text} from '${args.chain.name}' block ${hexToNumber(block.number)}`,
          });
        } else {
          args.common.logger.info({
            service: "realtime",
            msg: `Synced block ${hexToNumber(block.number)} from '${args.chain.name}' `,
          });
        }

        unfinalizedBlocks.push(syncBlockToLightBlock(block));

        // Make sure `transactions` can be garbage collected
        blockWithEventData.block.transactions =
          blockWithFilteredEventData.block.transactions;

        const blockPromise = args.onEvent({
          type: "block",
          hasMatchedFilter: blockWithFilteredEventData.matchedFilters.size > 0,
          block: blockWithFilteredEventData.block,
          logs: blockWithFilteredEventData.logs,
          transactions: blockWithFilteredEventData.transactions,
          transactionReceipts: blockWithFilteredEventData.transactionReceipts,
          traces: blockWithFilteredEventData.traces,
          childAddresses: blockWithFilteredEventData.childAddresses,
        });

        // Determine if a new range has become finalized by evaluating if the
        // latest block number is 2 * finalityBlockCount >= finalized block number.
        // Essentially, there is a range the width of finalityBlockCount that is entirely
        // finalized.

        let finalizePromise: Promise<{ promise: Promise<void> }> | undefined;
        const blockMovesFinality =
          hexToNumber(block.number) >=
          hexToNumber(finalizedBlock.number) +
            2 * args.chain.finalityBlockCount;
        if (blockMovesFinality) {
          const pendingFinalizedBlock = unfinalizedBlocks.find(
            (lb) =>
              hexToNumber(lb.number) ===
              hexToNumber(block.number) - args.chain.finalityBlockCount,
          )!;

          args.common.logger.debug({
            service: "realtime",
            msg: `Finalized ${hexToNumber(pendingFinalizedBlock.number) - hexToNumber(finalizedBlock.number) + 1} '${
              args.chain.name
            }' blocks [${hexToNumber(finalizedBlock.number) + 1}, ${hexToNumber(pendingFinalizedBlock.number)}]`,
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

          finalizePromise = args.onEvent({
            type: "finalize",
            block: pendingFinalizedBlock,
          });
        }

        // Reset the error state after successfully completing the happy path.
        reconcileBlockErrorCount = 0;

        return {
          type: "accepted",
          blockPromise: blockPromise.then((result) => result.promise),
          finalizePromise: finalizePromise?.then((result) => result.promise),
        };
      } catch (_error) {
        const error = _error as Error;

        if (args.common.shutdown.isKilled) {
          throw new ShutdownError();
        }

        args.common.logger.warn({
          service: "realtime",
          msg: `Failed to process '${args.chain.name}' block ${hexToNumber(block.number)}`,
          error,
        });

        const duration = ERROR_TIMEOUT[reconcileBlockErrorCount]!;

        args.common.logger.warn({
          service: "realtime",
          msg: `Retrying '${args.chain.name}' sync after ${duration} ${
            duration === 1 ? "second" : "seconds"
          }.`,
        });

        await wait(duration * 1_000);

        // Remove all blocks from the queue. This protects against an
        // erroneous block causing a fatal error.
        reconcileBlock.clear(({ resolve }) => resolve({ type: "rejected" }));

        reconcileBlockErrorCount += 1;

        // After a certain number of attempts, emit a fatal error.
        if (reconcileBlockErrorCount === ERROR_TIMEOUT.length) {
          args.common.logger.error({
            service: "realtime",
            msg: `Fatal error: Unable to process '${args.chain.name}' block ${hexToNumber(block.number)} after ${ERROR_TIMEOUT.length} attempts.`,
            error,
          });

          args.onFatalError(error);
        }

        return { type: "rejected" };
      }
    },
  );

  const onError = (error: Error) => {
    if (args.common.shutdown.isKilled) {
      throw new ShutdownError();
    }

    args.common.logger.warn({
      service: "realtime",
      msg: `Failed to fetch latest '${args.chain.name}' block`,
      error,
    });

    fetchAndReconcileLatestBlockErrorCount += 1;

    // After a certain number of attempts, emit a fatal error.
    if (
      fetchAndReconcileLatestBlockErrorCount * args.chain.pollingInterval >
      MAX_LATEST_BLOCK_ATTEMPT_MS
    ) {
      args.common.logger.error({
        service: "realtime",
        msg: `Fatal error: Unable to fetch latest '${args.chain.name}' block after ${ERROR_TIMEOUT.length} attempts.`,
        error,
      });

      args.onFatalError(error);
    }
  };

  return {
    sync(block) {
      return fetchAndReconcileLatestBlock(block);
    },
    onError,
    get unfinalizedBlocks() {
      return unfinalizedBlocks;
    },
    get childAddresses() {
      return childAddresses;
    },
  };
};
