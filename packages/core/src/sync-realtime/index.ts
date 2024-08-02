import type { Common } from "@/common/common.js";
import type { Network } from "@/config/networks.js";
import { syncBlockToLightBlock } from "@/sync/index.js";
import type { Source } from "@/sync/source.js";
import type {
  LightBlock,
  SyncBlock,
  SyncLog,
  SyncTrace,
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
import { type Hash, hexToNumber } from "viem";
import { isFilterInBloom, zeroLogsBloom } from "./bloom.js";

export type RealtimeSync = {
  start(finalizedBlock: LightBlock): Promise<Queue<void, SyncBlock>>;
  kill(): Promise<void>;
};

type CreateRealtimeSyncParameters = {
  common: Common;
  network: Network;
  requestQueue: RequestQueue;
  sources: Source[];
  onEvent: (event: RealtimeSyncEvent) => void;
  onFatalError: (error: Error) => void;
};

export type RealtimeSyncEvent =
  | {
      type: "block";
      block: SyncBlock;
      logs: SyncLog[];
      traces: SyncTrace[];
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

    const { logs, traces, transactions, transactionReceipts } =
      await extract(block);

    // const hasLogEvent = newLogs.length > 0;
    // const hasCallTraceEvent = newPersistentCallTraces.length > 0;
    // const hasBlockEvent = service.blockSources.some(
    //   (blockSource) =>
    //     (newHeadBlockNumber - blockSource.criteria.offset) %
    //       blockSource.criteria.interval ===
    //     0,
    // );

    // if (hasLogEvent || hasCallTraceEvent) {
    //   const logCountText =
    //     newLogs.length === 1 ? "1 log" : `${newLogs.length} logs`;
    //   const traceCountText =
    //     newCallTraces.length === 1
    //       ? "1 call trace"
    //       : `${newCallTraces.length} call traces`;
    //   const text = [logCountText, traceCountText].join(" and ");
    //   service.common.logger.info({
    //     service: "realtime",
    //     msg: `Synced ${text} from '${service.network.name}' block ${newHeadBlockNumber}`,
    //   });
    // } else if (hasBlockEvent) {
    //   service.common.logger.info({
    //     service: "realtime",
    //     msg: `Synced block ${newHeadBlockNumber} from '${service.network.name}' `,
    //   });
    // }

    localChain.push(syncBlockToLightBlock(block));

    args.onEvent({
      type: "block",
      block,
      logs,
      traces,
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
    const newLocalChain = localChain.filter(
      (lb) => hexToNumber(lb.number) < hexToNumber(block.number),
    );

    // Block we are attempting to fit into the local chain.
    let remoteBlock = block;

    while (true) {
      const parentBlock = getLatestLocalBlock();

      if (parentBlock.hash === remoteBlock.parentHash) {
        localChain = newLocalChain;

        args.onEvent({ type: "reorg", block: parentBlock });

        args.common.logger.warn({
          service: "realtime",
          msg: `Reconciled ${hexToNumber(block.number) - hexToNumber(parentBlock.number)}-block reorg on '${
            args.network.name
          }' with common ancestor block ${parentBlock.number}`,
        });

        return;
      }

      if (newLocalChain.length === 0) break;
      else {
        remoteBlock = await _eth_getBlockByHash(args.requestQueue, {
          hash: remoteBlock.parentHash,
        });
        newLocalChain.pop();
      }
    }

    // No compatible block was found in the local chain, must be a deep reorg.

    const msg = `Encountered unrecoverable '${args.network.name}' reorg beyond finalized block ${hexToNumber(finalizedBlock.number)}`;

    args.common.logger.warn({ service: "realtime", msg });

    localChain = [];

    throw new Error(msg);
  };

  /**
   *
   * @param block
   */
  const extract = async (block: SyncBlock) => {
    ////////
    // Logs
    ////////

    // "eth_getLogs" calls can be skipped if no filters match `newHeadBlock.logsBloom`.
    const shouldRequestLogs =
      block.logsBloom === zeroLogsBloom ||
      args.sources.some(
        ({ filter }) =>
          filter.type === "log" &&
          isFilterInBloom({ bloom: block.logsBloom, filter }),
      );

    let logs: SyncLog[] = [];
    if (shouldRequestLogs) {
      logs = await _eth_getLogs(args.requestQueue, { blockHash: block.hash });
    }

    // Protect against RPCs returning empty logs. Known to happen near chain tip.
    if (
      shouldRequestLogs &&
      block.logsBloom !== zeroLogsBloom &&
      logs.length === 0
    ) {
      throw new Error(
        `Detected invalid '${args.network.name}' eth_getLogs response.`,
      );
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

    const shouldRequestTraces = args.sources.some(
      // @ts-ignore
      (s) => s.filter.type === "trace",
    );

    let traces: SyncTrace[] = [];
    if (shouldRequestTraces) {
      traces = await _trace_block(args.requestQueue, {
        blockNumber: hexToNumber(block.number),
      });
    }

    // Check that traces refer to the correct block
    for (const trace of traces) {
      if (trace.blockHash !== block.hash) {
        throw new Error(
          `Received call trace with block hash '${trace.blockHash}' that does not match current head block '${block.hash}'`,
        );
      }
    }

    // Protect against RPCs returning empty traces. Known to happen near chain tip.
    // Use the fact that any transaction produces a trace.
    if (
      shouldRequestTraces &&
      block.transactions.length !== 0 &&
      traces.length === 0
    ) {
      throw new Error(
        `Detected invalid '${args.network.name}' trace_block response.`,
      );
    }

    ////////
    // Transactions
    ////////

    const transactionHashes = new Set<Hash>();
    for (const log of logs) {
      transactionHashes.add(log.transactionHash);
    }
    for (const trace of traces) {
      if (trace.type === "call") {
        transactionHashes.add(trace.transactionHash);
      }
    }

    const transactions = block.transactions.filter((t) =>
      transactionHashes.has(t.hash),
    );

    ////////
    // Transaction Receipts
    ////////

    const shouldRequestTransactionReceipts =
      // @ts-ignore
      args.sources.some((s) => s.filter.includeTransactionReceipts) ||
      traces.length > 0;

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
      traces,
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
  };
};

// const getMatchedLogs = async (
//   service: Service,
//   {
//     logs,
//     upToBlockNumber,
//   }: {
//     logs: SyncLog[];
//     upToBlockNumber: bigint;
//   },
// ) => {
//   if (service.factoryLogSources.length === 0) {
//     return filterLogs({
//       logs,
//       logFilters: service.logSources.map((s) => s.criteria),
//     });
//   } else {
//     // Find and insert any new child contracts.
//     const matchedFactoryLogs = filterLogs({
//       logs,
//       logFilters: service.factoryLogSources.map((fs) => ({
//         address: fs.criteria.address,
//         topics: [fs.criteria.eventSelector],
//       })),
//     });

//     await service.syncStore.insertFactoryChildAddressLogs({
//       chainId: service.network.chainId,
//       logs: matchedFactoryLogs,
//     });

// WITH [log.addresses ] as VALUES(...) SELECT address from logs.address WHERE address in (addressSQL)

//     // Find any logs matching log filters or child contract filters.
//     // NOTE: It might make sense to just insert all logs rather than introduce
//     // a potentially slow DB operation here. It's a tradeoff between sync
//     // latency and database growth.
//     // NOTE: Also makes sense to hold factoryChildAddresses in memory rather than
//     // a query each interval.
//     const factoryLogFilters = await Promise.all(
//       service.factoryLogSources.map(async (factory) => {
//         const iterator = service.syncStore.getFactoryChildAddresses({
//           chainId: service.network.chainId,
//           factory: factory.criteria,
//           fromBlock: BigInt(factory.startBlock),
//           toBlock: upToBlockNumber,
//         });
//         const childContractAddresses: Address[] = [];
//         for await (const batch of iterator) {
//           childContractAddresses.push(...batch);
//         }
//         return {
//           address: childContractAddresses,
//           topics: factory.criteria.topics,
//         };
//       }),
//     );

//     return filterLogs({
//       logs,
//       logFilters: [
//         ...service.logSources.map((l) => l.criteria),
//         ...factoryLogFilters.filter((f) => f.address.length !== 0),
//       ],
//     });
//   }
// };

// const getMatchedCallTraces = async (
//   service: Service,
//   {
//     callTraces,
//     logs,
//     upToBlockNumber,
//   }: {
//     callTraces: SyncCallTrace[];
//     logs: SyncLog[];
//     upToBlockNumber: bigint;
//   },
// ) => {
//   if (service.factoryCallTraceSources.length === 0) {
//     return filterCallTraces({
//       callTraces,
//       callTraceFilters: service.callTraceSources.map((s) => s.criteria),
//     });
//   } else {
//     // Find and insert any new child contracts.
//     const matchedFactoryLogs = filterLogs({
//       logs,
//       logFilters: service.factoryLogSources.map((fs) => ({
//         address: fs.criteria.address,
//         topics: [fs.criteria.eventSelector],
//       })),
//     });

//     await service.syncStore.insertFactoryChildAddressLogs({
//       chainId: service.network.chainId,
//       logs: matchedFactoryLogs,
//     });

//     // Find any logs matching log filters or child contract filters.
//     // NOTE: It might make sense to just insert all logs rather than introduce
//     // a potentially slow DB operation here. It's a tradeoff between sync
//     // latency and database growth.
//     // NOTE: Also makes sense to hold factoryChildAddresses in memory rather than
//     // a query each interval.
//     const factoryTraceFilters = await Promise.all(
//       service.factoryCallTraceSources.map(async (factory) => {
//         const iterator = service.syncStore.getFactoryChildAddresses({
//           chainId: service.network.chainId,
//           factory: factory.criteria,
//           fromBlock: BigInt(factory.startBlock),
//           toBlock: upToBlockNumber,
//         });
//         const childContractAddresses: Address[] = [];
//         for await (const batch of iterator) {
//           childContractAddresses.push(...batch);
//         }
//         return {
//           toAddress: childContractAddresses,
//           fromAddress: factory.criteria.fromAddress,
//         };
//       }),
//     );

//     return filterCallTraces({
//       callTraces,
//       callTraceFilters: [
//         ...service.callTraceSources.map((s) => s.criteria),
//         ...factoryTraceFilters.filter((f) => f.toAddress.length !== 0),
//       ],
//     });
//   }
// };
