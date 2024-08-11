import type { Common } from "@/common/common.js";
import type { Network } from "@/config/networks.js";
import type { SyncStore } from "@/sync-store/index.js";
import { syncBlockToLightBlock } from "@/sync/index.js";
import {
  type CallTraceFilter,
  type Factory,
  type LogFilter,
  type Source,
  isAddressFactory,
} from "@/sync/source.js";
import type {
  LightBlock,
  SyncBlock,
  SyncCallTrace,
  SyncLog,
  SyncTransaction,
  SyncTransactionReceipt,
} from "@/types/sync.js";
import { range } from "@/utils/range.js";
import type { RequestQueue } from "@/utils/requestQueue.js";
import {
  _eth_getBlockByHash,
  _eth_getBlockByNumber,
  _eth_getLogs,
  _eth_getTransactionReceipt,
  _trace_block,
} from "@/utils/rpc.js";
import { wait } from "@/utils/wait.js";
import { type Queue, createQueue } from "@ponder/common";
import { type Address, type Hash, hexToNumber } from "viem";
import { isFilterInBloom, zeroLogsBloom } from "./bloom.js";
import {
  isCallTraceFilterMatched,
  isLogFactoryMatched,
  isLogFilterMatched,
} from "./filter.js";

export type RealtimeSync = {
  start(finalizedBlock: LightBlock): Promise<Queue<void, SyncBlock>>;
  kill(): Promise<void>;
  localChain: LightBlock[];
};

type CreateRealtimeSyncParameters = {
  common: Common;
  network: Network;
  requestQueue: RequestQueue;
  sources: Source[];
  syncStore: SyncStore;
  onEvent: (event: RealtimeSyncEvent) => void;
  onFatalError: (error: Error) => void;
};

export type RealtimeSyncEvent =
  | {
      type: "block";
      block: SyncBlock;
      logs: SyncLog[];
      callTraces: SyncCallTrace[];
      transactions: SyncTransaction[];
      transactionReceipts: SyncTransactionReceipt[];
    }
  | {
      type: "finalize";
      block: LightBlock;
    }
  | {
      type: "reorg";
      block: LightBlock;
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
  let isKilled = false;
  let finalizedBlock: LightBlock;
  /**
   * Blocks and logs that have been ingested and are
   * waiting to be finalized. It is an invariant that
   * all blocks are linked to each other,
   * `parentHash` => `hash`.
   */
  let localChain: LightBlock[] = [];
  let queue: Queue<void, SyncBlock>;
  let consecutiveErrors = 0;
  let interval: NodeJS.Timeout | undefined;

  const factories: Factory[] = [];
  const logFilters: LogFilter[] = [];
  const callTraceFilters: CallTraceFilter[] = [];

  for (const source of args.sources) {
    if (source.type === "contract") {
      if (source.filter.type === "log") {
        logFilters.push(source.filter);
      } else if (source.filter.type === "callTrace") {
        callTraceFilters.push(source.filter);
      }

      const _address =
        source.filter.type === "log"
          ? source.filter.address
          : source.filter.toAddress;
      if (isAddressFactory(_address)) {
        factories.push(_address);
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
  const handleBlock = async (block: SyncBlock) => {
    args.common.logger.debug({
      service: "realtime",
      msg: `Started syncing '${args.network.name}' block ${hexToNumber(block.number)}`,
    });

    const { logs, callTraces, transactions, transactionReceipts } =
      await extract(block);

    if (logs.length > 0 || callTraces.length > 0) {
      const _text: string[] = [];

      if (logs.length === 1) {
        _text.push("1 log");
      } else if (logs.length > 1) {
        _text.push(`${logs.length} logs`);
      }

      if (callTraces.length === 1) {
        _text.push("1 call trace");
      } else if (callTraces.length > 1) {
        _text.push(`${callTraces.length} call traces`);
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

    localChain.push(syncBlockToLightBlock(block));

    args.onEvent({
      type: "block",
      block,
      logs,
      callTraces,
      transactions,
      transactionReceipts,
    });

    args.common.metrics.ponder_realtime_latest_block_number.set(
      { network: args.network.name },
      hexToNumber(block.number),
    );
    args.common.metrics.ponder_realtime_latest_block_timestamp.set(
      { network: args.network.name },
      hexToNumber(block.timestamp),
    );

    // Determine if a new range has become finalized by evaluating if the
    // latest block number is 2 * finalityBlockCount >= finalized block number.
    // Essentially, there is a range the width of finalityBlockCount that is entirely
    // finalized.
    const blockMovesFinality =
      hexToNumber(block.number) >=
      hexToNumber(finalizedBlock.number) + 2 * args.network.finalityBlockCount;
    if (blockMovesFinality) {
      const pendingFinalizedBlock = localChain.find(
        (lb) =>
          hexToNumber(lb.number) ===
          hexToNumber(block.number) - args.network.finalityBlockCount,
      )!;

      args.common.logger.debug({
        service: "realtime",
        msg: `Finalized ${hexToNumber(pendingFinalizedBlock.number) - hexToNumber(finalizedBlock.number) + 1} '${
          args.network.name
        }' blocks from ${hexToNumber(finalizedBlock.number) + 1} to ${pendingFinalizedBlock.number}`,
      });

      localChain = localChain.filter(
        (lb) =>
          hexToNumber(lb.number) > hexToNumber(pendingFinalizedBlock.number),
      );

      finalizedBlock = pendingFinalizedBlock;

      args.onEvent({ type: "finalize", block: pendingFinalizedBlock });
    }

    args.common.logger.debug({
      service: "realtime",
      msg: `Finished syncing '${args.network.name}' block ${hexToNumber(block.number)}`,
    });
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

    // Prune the local chain of blocks that have been reorged out
    localChain = localChain.filter(
      (lb) => hexToNumber(lb.number) < hexToNumber(block.number),
    );

    // Block we are attempting to fit into the local chain.
    let remoteBlock = block;

    while (true) {
      const parentBlock = getLatestLocalBlock();

      if (parentBlock.hash === remoteBlock.parentHash) {
        args.onEvent({ type: "reorg", block: parentBlock });

        args.common.logger.warn({
          service: "realtime",
          msg: `Reconciled ${hexToNumber(block.number) - hexToNumber(parentBlock.number)}-block reorg on '${
            args.network.name
          }' with common ancestor block ${parentBlock.number}`,
        });

        return;
      }

      if (localChain.length === 0) break;
      else {
        remoteBlock = await _eth_getBlockByHash(args.requestQueue, {
          hash: remoteBlock.parentHash,
        });
        localChain.pop();
      }
    }

    // No compatible block was found in the local chain, must be a deep reorg.

    const msg = `Encountered unrecoverable '${args.network.name}' reorg beyond finalized block ${hexToNumber(finalizedBlock.number)}`;

    args.common.logger.warn({ service: "realtime", msg });

    throw new Error(msg);
  };

  /**
   * Request and filter all relevant data pertaining to `block` and `args.sources`
   */
  const extract = async (block: SyncBlock) => {
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
          `Detected invalid '${args.network.name}' eth_getLogs response.`,
        );
      }
    }

    if (
      shouldRequestLogs === false &&
      args.sources.some((s) => s.filter.type === "log")
    ) {
      args.common.logger.debug({
        service: "realtime",
        msg: `Skipped fetching logs for '${args.network.name}' block ${hexToNumber(block.number)} due to bloom filter result`,
      });
    }

    ////////
    // Traces
    ////////

    const shouldRequestTraces = callTraceFilters.length > 0;

    let callTraces: SyncCallTrace[] = [];
    if (shouldRequestTraces) {
      const traces = await _trace_block(args.requestQueue, {
        blockNumber: hexToNumber(block.number),
      });

      // Protect against RPCs returning empty traces. Known to happen near chain tip.
      // Use the fact that any transaction produces a trace.
      if (block.transactions.length !== 0 && traces.length === 0) {
        throw new Error(
          `Detected invalid '${args.network.name}' trace_block response.`,
        );
      }

      callTraces = traces.filter(
        (trace) => trace.type === "call",
      ) as SyncCallTrace[];
    }

    // Check that traces refer to the correct block
    for (const trace of callTraces) {
      if (trace.blockHash !== block.hash) {
        throw new Error(
          `Received call trace with block hash '${trace.blockHash}' that does not match current head block '${block.hash}'`,
        );
      }
    }

    ////////
    // Get Matched
    ////////

    // Insert `logs` that contain factory child addresses
    const _logs = logs.filter((log) =>
      factories.some((filter) => isLogFactoryMatched({ filter, log })),
    );
    await args.syncStore.insertLogs({
      logs: _logs.map((log) => ({ log })),
      chainId: args.network.chainId,
    });

    // ...
    const childAddresses = new Set<Address>();
    for (const filter of factories) {
      if (logs.length > 0) {
        const _childAddresses = await args.syncStore.filterChildAddresses({
          filter,
          addresses: logs.map(({ address }) => address),
        });
        for (const address of _childAddresses) childAddresses.add(address);
      }
    }

    // Remote logs that don't match a filter
    logs = logs.filter((log) =>
      logFilters.some((filter) => {
        const isMatched = isLogFilterMatched({ filter, block, log });

        if (isAddressFactory(filter.address)) {
          return isMatched && childAddresses.has(log.address);
        }

        return isMatched;
      }),
    );

    // Remote call traces that don't match a filter
    callTraces = callTraces.filter((callTrace) =>
      callTraceFilters.some((filter) => {
        const isMatched = isCallTraceFilterMatched({
          filter,
          block,
          callTrace,
        });

        if (isAddressFactory(filter.toAddress)) {
          return isMatched && childAddresses.has(callTrace.action.to);
        }

        return isMatched;
      }),
    );

    ////////
    // Transactions
    ////////

    const transactionHashes = new Set<Hash>();
    for (const log of logs) {
      transactionHashes.add(log.transactionHash);
    }
    for (const trace of callTraces) {
      transactionHashes.add(trace.transactionHash);
    }

    const transactions = block.transactions.filter((t) =>
      transactionHashes.has(t.hash),
    );

    ////////
    // Transaction Receipts
    ////////

    const shouldRequestTransactionReceipts =
      args.sources.some(
        (s) => s.type === "contract" && s.filter.includeTransactionReceipts,
      ) || callTraces.length > 0;

    let transactionReceipts: SyncTransactionReceipt[] = [];
    if (shouldRequestTransactionReceipts) {
      transactionReceipts = await Promise.all(
        transactions.map(({ hash }) =>
          _eth_getTransactionReceipt(args.requestQueue, { hash }),
        ),
      );
    }

    return {
      logs,
      callTraces,
      transactions,
      transactionReceipts,
    };
  };

  const getLatestLocalBlock = () => {
    if (localChain.length === 0) {
      return finalizedBlock;
    } else return localChain[localChain.length - 1]!;
  };

  return {
    start(_finalizedBlock) {
      finalizedBlock = _finalizedBlock;
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
      queue = createQueue({
        browser: false,
        concurrency: 1,
        initialStart: true,
        worker: async (block: SyncBlock) => {
          const latestLocalBlock = getLatestLocalBlock();

          // We already saw and handled this block. No-op.
          if (latestLocalBlock.hash === block.hash) {
            args.common.logger.trace({
              service: "realtime",
              msg: `Skipped processing '${args.network.name}' block ${hexToNumber(block.number)}, already synced`,
            });

            return;
          }

          try {
            // Quickly check for a reorg by comparing block numbers. If the block
            // number has not increased, a reorg must have occurred.
            if (
              hexToNumber(latestLocalBlock.number) >= hexToNumber(block.number)
            ) {
              await handleReorg(block);

              queue.clear();
              return;
            }

            // Blocks are missing. They should be fetched and enqueued.
            if (
              hexToNumber(latestLocalBlock.number) + 1 <
              hexToNumber(block.number)
            ) {
              // Retrieve missing blocks, but only fetch a certain amount.
              const missingBlockRange = range(
                hexToNumber(latestLocalBlock.number) + 1,
                Math.min(
                  hexToNumber(block.number),
                  hexToNumber(latestLocalBlock.number) + MAX_QUEUED_BLOCKS,
                ),
              );
              const pendingBlocks = await Promise.all(
                missingBlockRange.map((blockNumber) =>
                  _eth_getBlockByNumber(args.requestQueue, { blockNumber }),
                ),
              );

              args.common.logger.debug({
                service: "realtime",
                msg: `Fetched ${missingBlockRange.length} missing '${
                  args.network.name
                }' blocks from ${latestLocalBlock.number + 1} to ${Math.min(
                  hexToNumber(block.number),
                  hexToNumber(latestLocalBlock.number) + MAX_QUEUED_BLOCKS,
                )}`,
              });

              // This is needed to ensure proper `kill()` behavior. When the service
              // is killed, nothing should be added to the queue, or else `onIdle()`
              // will never resolve.
              if (isKilled) return;

              queue.clear();

              for (const pendingBlock of pendingBlocks) {
                queue.add(pendingBlock);
              }

              queue.add(block);

              return;
            }

            // Check if a reorg occurred by validating the chain of block hashes.
            if (block.parentHash !== latestLocalBlock.hash) {
              await handleReorg(block);
              queue.clear();
              return;
            }

            // New block is exactly one block ahead of the local chain.
            // Attempt to ingest it.
            await handleBlock(block);

            // Reset the error state after successfully completing the happy path.
            consecutiveErrors = 0;

            return;
          } catch (_error) {
            if (isKilled) return;

            const error = _error as Error;
            error.stack = undefined;

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
            queue.clear();

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
      });

      const enqueue = async () => {
        try {
          const block = await _eth_getBlockByNumber(args.requestQueue, {
            blockTag: "latest",
          });

          return queue.add(block);
        } catch (_error) {
          if (isKilled) return;

          const error = _error as Error;

          args.common.logger.warn({
            service: "realtime",
            msg: `Failed to fetch latest '${args.network.name}' block`,
            error,
          });
        }
      };

      interval = setInterval(enqueue, args.network.pollingInterval);

      // Note: this is done just for testing.
      return enqueue().then(() => queue);
    },
    async kill() {
      clearInterval(interval);
      isKilled = true;
      queue.pause();
      queue.clear();

      args.common.logger.debug({
        service: "realtime",
        msg: `Killed '${args.network.name}' realtime sync`,
      });

      await queue.onIdle();
    },
    get localChain() {
      return localChain;
    },
  };
};
