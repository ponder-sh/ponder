import type { Common } from "@/internal/common.js";
import { ShutdownError } from "@/internal/errors.js";
import type {
  BlockFilter,
  Factory,
  Filter,
  LightBlock,
  LogFilter,
  Network,
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
import type { Queue } from "@/utils/queue.js";
import { range } from "@/utils/range.js";
import type { RequestQueue } from "@/utils/requestQueue.js";
import {
  _debug_traceBlockByHash,
  _eth_getBlockByHash,
  _eth_getBlockByNumber,
  _eth_getBlockReceipts,
  _eth_getLogs,
  _eth_getTransactionReceipt,
} from "@/utils/rpc.js";
import { startClock } from "@/utils/timer.js";
import { wait } from "@/utils/wait.js";
import { type Address, type Hash, hexToNumber, zeroHash } from "viem";
import { isFilterInBloom, zeroLogsBloom } from "./bloom.js";

export type RealtimeSync = {
  start(args: {
    syncProgress: Pick<SyncProgress, "finalized">;
    initialChildAddresses: Map<Factory, Map<Address, number>>;
  }): Promise<Queue<void, BlockWithEventData>>;
  unfinalizedBlocks: LightBlock[];
  childAddresses: Map<Factory, Map<Address, number>>;
  kill: () => void;
};

type CreateRealtimeSyncParameters = {
  common: Common;
  network: Network;
  requestQueue: RequestQueue;
  sources: Source[];
  onEvent: (event: RealtimeSyncEvent) => Promise<void>;
  onFatalError: (error: Error) => void;
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
      endClock?: () => number;
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
  let finalizedBlock: LightBlock;
  let childAddresses = new Map<Factory, Map<Address, number>>();
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
  let consecutiveErrors = 0;
  let interval: NodeJS.Timeout | undefined;

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

  /**
   * 1) Determine if a reorg occurred.
   * 2) Insert new event data into the store.
   * 3) Determine if a new range of events has become finalized,
   *    if so insert interval to store and remove the finalized data.
   *
   * @param block Block to be injested. Must be exactly
   * 1 block ahead of the local chain.
   * @returns true if a reorg occurred
   */
  const handleBlock = async ({
    block,
    logs,
    traces,
    transactions,
    transactionReceipts,
    childAddresses: blockChildAddresses,
    endClock,
  }: BlockWithEventData & { endClock?: () => number }) => {
    args.common.logger.debug({
      service: "realtime",
      msg: `Started syncing '${args.network.name}' block ${hexToNumber(block.number)}`,
    });

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

    if (logs.length > 0 || traces.length > 0 || transactions.length > 0) {
      const _text: string[] = [];

      if (logs.length === 1) {
        _text.push("1 log");
      } else if (logs.length > 1) {
        _text.push(`${logs.length} logs`);
      }

      if (traces.length === 1) {
        _text.push("1 trace");
      } else if (traces.length > 1) {
        _text.push(`${traces.length} traces`);
      }

      if (transactions.length === 1) {
        _text.push("1 transaction");
      } else if (transactions.length > 1) {
        _text.push(`${transactions.length} transactions`);
      }

      const text = _text.filter((t) => t !== undefined).join(" and ");
      args.common.logger.info({
        service: "realtime",
        msg: `Synced ${text} from '${args.network.name}' block ${hexToNumber(block.number)}`,
      });
    } else {
      args.common.logger.info({
        service: "realtime",
        msg: `Synced block ${hexToNumber(block.number)} from '${args.network.name}' `,
      });
    }

    unfinalizedBlocks.push(syncBlockToLightBlock(block));

    // Make sure `transactions` can be garbage collected
    // @ts-ignore
    block.transactions = undefined;

    await args.onEvent({
      type: "block",
      hasMatchedFilter: matchedFilters.size > 0,
      block,
      logs,
      transactions,
      transactionReceipts,
      traces,
      childAddresses: blockChildAddresses,
      endClock,
    });

    // Determine if a new range has become finalized by evaluating if the
    // latest block number is 2 * finalityBlockCount >= finalized block number.
    // Essentially, there is a range the width of finalityBlockCount that is entirely
    // finalized.
    const blockMovesFinality =
      hexToNumber(block.number) >=
      hexToNumber(finalizedBlock.number) + 2 * args.network.finalityBlockCount;
    if (blockMovesFinality) {
      const pendingFinalizedBlock = unfinalizedBlocks.find(
        (lb) =>
          hexToNumber(lb.number) ===
          hexToNumber(block.number) - args.network.finalityBlockCount,
      )!;

      args.common.logger.debug({
        service: "realtime",
        msg: `Finalized ${hexToNumber(pendingFinalizedBlock.number) - hexToNumber(finalizedBlock.number) + 1} '${
          args.network.name
        }' blocks [${hexToNumber(finalizedBlock.number) + 1}, ${hexToNumber(pendingFinalizedBlock.number)}]`,
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

      await args.onEvent({ type: "finalize", block: pendingFinalizedBlock });
    }
  };

  /**
   * Traverse the remote chain until we find a block that is
   * compatible with out local chain.
   *
   * @param block Block that caused reorg to be detected.
   * Must be at most 1 block ahead of the local chain.
   */
  const handleReorg = async (block: SyncBlock) => {
    args.common.logger.warn({
      service: "realtime",
      msg: `Detected forked '${args.network.name}' block at height ${hexToNumber(block.number)}`,
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

        const msg = `Encountered unrecoverable '${args.network.name}' reorg beyond finalized block ${hexToNumber(finalizedBlock.number)}`;

        const error = new Error(msg);
        args.common.logger.error({ service: "realtime", msg });
        args.onFatalError(error);
        return;
      } else {
        remoteBlock = await _eth_getBlockByHash(args.requestQueue, {
          hash: remoteBlock.parentHash,
        });
        // Add tip to `reorgedBlocks`
        reorgedBlocks.push(unfinalizedBlocks.pop()!);
      }
    }

    const commonAncestor = getLatestUnfinalizedBlock();

    await args.onEvent({ type: "reorg", block: commonAncestor, reorgedBlocks });

    args.common.logger.warn({
      service: "realtime",
      msg: `Reconciled ${reorgedBlocks.length}-block '${
        args.network.name
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
          _eth_getTransactionReceipt(args.requestQueue, { hash }),
        ),
      );

      return transactionReceipts;
    }

    let blockReceipts: SyncTransactionReceipt[];
    try {
      blockReceipts = await _eth_getBlockReceipts(args.requestQueue, {
        blockHash,
      });
    } catch (_error) {
      const error = _error as Error;
      args.common.logger.warn({
        service: "realtime",
        msg: `Caught eth_getBlockReceipts error on '${
          args.network.name
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

  /**
   * Fetch all data (logs, traces, receipts) for the specified block required by `args.sources`
   *
   * Note: The data returned by this function may include false positives. This
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
      logs = await _eth_getLogs(args.requestQueue, { blockHash: block.hash });

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

        if (
          block.transactions.find((t) => t.hash === log.transactionHash) ===
          undefined
        ) {
          if (log.transactionHash === zeroHash) {
            args.common.logger.warn({
              service: "sync",
              msg: `Detected '${args.network.name}' log with empty transaction hash in block ${block.hash} at log index ${hexToNumber(log.logIndex)}. This is expected for some networks like ZKsync.`,
            });
          } else {
            throw new Error(
              `Detected inconsistent '${args.network.name}' RPC responses. 'log.transactionHash' ${log.transactionHash} not found in 'block.transactions' ${block.hash}`,
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
        msg: `Skipped fetching '${args.network.name}' logs for block ${hexToNumber(block.number)} due to bloom filter result`,
      });
    }

    ////////
    // Traces
    ////////

    const shouldRequestTraces =
      traceFilters.length > 0 || transferFilters.length > 0;

    let traces: SyncTrace[] = [];
    if (shouldRequestTraces) {
      traces = await _debug_traceBlockByHash(args.requestQueue, {
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
              msg: `Detected '${args.network.name}' log with empty transaction hash in block ${block.hash} at log index ${hexToNumber(log.logIndex)}. This is expected for some networks like ZKsync.`,
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

  const getLatestUnfinalizedBlock = () => {
    if (unfinalizedBlocks.length === 0) {
      return finalizedBlock;
    } else return unfinalizedBlocks[unfinalizedBlocks.length - 1]!;
  };

  return {
    start(startArgs) {
      finalizedBlock = startArgs.syncProgress.finalized;
      childAddresses = startArgs.initialChildAddresses;
      /**
       * The queue reacts to a new block. The four states are:
       * 1) Block is the same as the one just processed, no-op.
       * 2) Block is exactly one block ahead of the last processed,
       *    handle this new block (happy path).
       * 3) Block is more than one ahead of the last processed,
       *    fetch all intermediate blocks and enqueue them again.
       * 4) Block is behind the last processed. This is a sign that
       *    a reorg has occurred.
       */
      const processBlock = mutex(
        async ({
          block,
          ...rest
        }: BlockWithEventData & { endClock?: () => number }) => {
          const latestBlock = getLatestUnfinalizedBlock();

          // We already saw and handled this block. No-op.
          if (latestBlock.hash === block.hash) {
            args.common.logger.trace({
              service: "realtime",
              msg: `Skipped processing '${args.network.name}' block ${hexToNumber(block.number)}, already synced`,
            });

            return;
          }

          try {
            // Quickly check for a reorg by comparing block numbers. If the block
            // number has not increased, a reorg must have occurred.
            if (hexToNumber(latestBlock.number) >= hexToNumber(block.number)) {
              await handleReorg(block);

              processBlock.clear();
              return;
            }

            // Blocks are missing. They should be fetched and enqueued.
            if (
              hexToNumber(latestBlock.number) + 1 <
              hexToNumber(block.number)
            ) {
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
                  _eth_getBlockByNumber(args.requestQueue, {
                    blockNumber,
                  }).then((block) => fetchBlockEventData(block)),
                ),
              );

              args.common.logger.debug({
                service: "realtime",
                msg: `Fetched ${missingBlockRange.length} missing '${
                  args.network.name
                }' blocks [${hexToNumber(latestBlock.number) + 1}, ${Math.min(
                  hexToNumber(block.number),
                  hexToNumber(latestBlock.number) + MAX_QUEUED_BLOCKS,
                )}]`,
              });

              processBlock.clear();

              for (const pendingBlock of pendingBlocks) {
                processBlock(pendingBlock);
              }

              processBlock({ block, ...rest });

              return;
            }

            // Check if a reorg occurred by validating the chain of block hashes.
            if (block.parentHash !== latestBlock.hash) {
              await handleReorg(block);
              processBlock.clear();
              return;
            }

            // New block is exactly one block ahead of the local chain.
            // Attempt to ingest it.
            await handleBlock({ block, ...rest });

            // Reset the error state after successfully completing the happy path.
            consecutiveErrors = 0;

            return;
          } catch (_error) {
            const error = _error as Error;

            if (args.common.shutdown.isKilled) {
              throw new ShutdownError();
            }

            args.common.logger.warn({
              service: "realtime",
              msg: `Failed to process '${args.network.name}' block ${hexToNumber(block.number)}`,
              error,
            });

            const duration = ERROR_TIMEOUT[consecutiveErrors]!;

            args.common.logger.warn({
              service: "realtime",
              msg: `Retrying '${args.network.name}' sync after ${duration} ${
                duration === 1 ? "second" : "seconds"
              }.`,
            });

            await wait(duration * 1_000);

            // Remove all blocks from the queue. This protects against an
            // erroneous block causing a fatal error.
            processBlock.clear();

            // After a certain number of attempts, emit a fatal error.
            if (++consecutiveErrors === ERROR_TIMEOUT.length) {
              args.common.logger.error({
                service: "realtime",
                msg: `Fatal error: Unable to process '${args.network.name}' block ${hexToNumber(block.number)} after ${ERROR_TIMEOUT.length} attempts.`,
                error,
              });

              args.onFatalError(error);
            }
          }
        },
      );

      const enqueue = async () => {
        try {
          const block = await _eth_getBlockByNumber(args.requestQueue, {
            blockTag: "latest",
          });

          args.common.logger.debug({
            service: "realtime",
            msg: `Received latest '${args.network.name}' block ${hexToNumber(block.number)}`,
          });

          const latestBlock = getLatestUnfinalizedBlock();

          // We already saw and handled this block. No-op.
          if (latestBlock.hash === block.hash) {
            args.common.logger.trace({
              service: "realtime",
              msg: `Skipped processing '${args.network.name}' block ${hexToNumber(block.number)}, already synced`,
            });

            return;
          }

          const endClock = startClock();

          const blockWithEventData = await fetchBlockEventData(block);

          consecutiveErrors = 0;

          return processBlock({ ...blockWithEventData, endClock });
        } catch (_error) {
          const error = _error as Error;

          if (args.common.shutdown.isKilled) {
            throw new ShutdownError();
          }

          args.common.logger.warn({
            service: "realtime",
            msg: `Failed to fetch latest '${args.network.name}' block`,
            error,
          });

          // After a certain number of attempts, emit a fatal error.
          if (++consecutiveErrors === ERROR_TIMEOUT.length) {
            args.common.logger.error({
              service: "realtime",
              msg: `Fatal error: Unable to fetch latest '${args.network.name}' block after ${ERROR_TIMEOUT.length} attempts.`,
              error,
            });

            args.onFatalError(error);
          }
        }
      };

      interval = setInterval(enqueue, args.network.pollingInterval);

      args.common.shutdown.add(() => {
        clearInterval(interval);
      });

      // Note: this is done just for testing.
      return enqueue().then(() => processBlock);
    },
    get unfinalizedBlocks() {
      return unfinalizedBlocks;
    },
    get childAddresses() {
      return childAddresses;
    },
    async kill() {
      clearInterval(interval);
    },
  };
};
