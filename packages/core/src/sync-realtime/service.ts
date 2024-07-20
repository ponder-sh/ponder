import type { Common } from "@/common/common.js";
import type { Network } from "@/config/networks.js";
import {
  type BlockSource,
  type CallTraceSource,
  type EventSource,
  type FactoryCallTraceSource,
  type FactoryLogSource,
  type LogSource,
  sourceIsBlock,
  sourceIsCallTrace,
  sourceIsFactoryCallTrace,
  sourceIsFactoryLog,
  sourceIsLog,
} from "@/config/sources.js";
import type { SyncStore } from "@/sync-store/store.js";
import {
  type SyncBlock,
  type SyncCallTrace,
  type SyncLog,
  _eth_getBlockByHash,
  _eth_getBlockByNumber,
  _eth_getLogs,
  _eth_getTransactionReceipt,
  _trace_block,
} from "@/sync/index.js";
import { type Checkpoint, maxCheckpoint } from "@/utils/checkpoint.js";
import { range } from "@/utils/range.js";
import type { RequestQueue } from "@/utils/requestQueue.js";
import { wait } from "@/utils/wait.js";
import { type Queue, createQueue } from "@ponder/common";
import { type Address, type Hash, hexToNumber } from "viem";
import { isMatchedLogInBloomFilter, zeroLogsBloom } from "./bloom.js";
import { filterCallTraces, filterLogs } from "./filter.js";
import { type LightBlock, syncBlockToLightBlock } from "./format.js";

export type Service = {
  // static
  common: Common;
  syncStore: SyncStore;
  network: Network;
  requestQueue: RequestQueue;
  sources: EventSource[];

  // state
  isKilled: boolean;
  finalizedBlock: LightBlock;
  /**
   * Blocks and logs that have been ingested and are
   * waiting to be finalized. It is an invariant that
   * all blocks are linked to each other,
   * `parentHash` => `hash`.
   */
  localChain: LightBlock[];
  queue: Queue<void, SyncBlock> | undefined;
  consecutiveErrors: number;

  // callbacks
  onEvent: (event: RealtimeSyncEvent) => void;
  onFatalError: (error: Error) => void;

  // derived static
  hasTransactionReceiptSource: boolean;
  logSources: LogSource[];
  factoryLogSources: FactoryLogSource[];
  callTraceSources: CallTraceSource[];
  factoryCallTraceSources: FactoryCallTraceSource[];
  blockSources: BlockSource[];
};

export type RealtimeSyncEvent =
  | {
      type: "reorg";
      chainId: number;
      safeCheckpoint: Checkpoint;
    }
  | {
      type: "checkpoint";
      chainId: number;
      checkpoint: Checkpoint;
    }
  | {
      type: "finalize";
      chainId: number;
      checkpoint: Checkpoint;
    };

const ERROR_TIMEOUT = [
  1, 2, 5, 10, 30, 60, 60, 60, 60, 60, 60, 60, 60, 60,
] as const;
const MAX_QUEUED_BLOCKS = 25;

export const create = ({
  common,
  syncStore,
  network,
  requestQueue,
  sources,
  finalizedBlock,
  onEvent,
  onFatalError,
}: {
  common: Common;
  syncStore: SyncStore;
  network: Network;
  requestQueue: RequestQueue;
  sources: EventSource[];
  finalizedBlock: SyncBlock;
  onEvent: (event: RealtimeSyncEvent) => void;
  onFatalError: (error: Error) => void;
}): Service => {
  const logSources = sources.filter(sourceIsLog);
  const factoryLogSources = sources.filter(sourceIsFactoryLog);
  const blockSources = sources.filter(sourceIsBlock);
  const callTraceSources = sources.filter(sourceIsCallTrace);
  const factoryCallTraceSources = sources.filter(sourceIsFactoryCallTrace);

  return {
    common,
    syncStore,
    network,
    requestQueue,
    sources,
    isKilled: false,
    finalizedBlock: syncBlockToLightBlock(finalizedBlock),
    localChain: [],
    queue: undefined,
    consecutiveErrors: 0,
    onEvent,
    onFatalError,
    hasTransactionReceiptSource:
      logSources.some((s) => s.criteria.includeTransactionReceipts) ||
      factoryLogSources.some((s) => s.criteria.includeTransactionReceipts),
    logSources,
    factoryLogSources,
    callTraceSources,
    factoryCallTraceSources,
    blockSources,
  };
};

export const start = (service: Service) => {
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
  const queue = createQueue({
    browser: false,
    concurrency: 1,
    initialStart: true,
    worker: async (newHeadBlock: SyncBlock) => {
      const latestLocalBlock = getLatestLocalBlock(service);
      const newHeadBlockNumber = hexToNumber(newHeadBlock.number);

      // We already saw and handled this block. No-op.
      if (latestLocalBlock.hash === newHeadBlock.hash) {
        service.common.logger.trace({
          service: "realtime",
          msg: `Skipped processing '${service.network.name}' block ${newHeadBlockNumber}, already synced`,
        });

        return;
      }

      try {
        // Quickly check for a reorg by comparing block numbers. If the block
        // number has not increased, a reorg must have occurred.
        if (latestLocalBlock.number >= newHeadBlockNumber) {
          await handleReorg(service, newHeadBlock);

          queue.clear();
          return;
        }

        // Blocks are missing. They should be fetched and enqueued.
        if (latestLocalBlock.number + 1 < newHeadBlockNumber) {
          // Retrieve missing blocks, but only fetch a certain amount.
          const missingBlockRange = range(
            latestLocalBlock.number + 1,
            Math.min(
              newHeadBlockNumber,
              latestLocalBlock.number + MAX_QUEUED_BLOCKS,
            ),
          );
          const pendingBlocks = await Promise.all(
            missingBlockRange.map((blockNumber) =>
              _eth_getBlockByNumber(service, { blockNumber }),
            ),
          );

          service.common.logger.debug({
            service: "realtime",
            msg: `Fetched ${missingBlockRange.length} missing '${
              service.network.name
            }' blocks from ${latestLocalBlock.number + 1} to ${Math.min(
              newHeadBlockNumber,
              latestLocalBlock.number + MAX_QUEUED_BLOCKS,
            )}`,
          });

          // This is needed to ensure proper `kill()` behavior. When the service
          // is killed, nothing should be added to the queue, or else `onIdle()`
          // will never resolve.
          if (service.isKilled) return;

          queue.clear();

          for (const pendingBlock of pendingBlocks) {
            queue.add(pendingBlock);
          }

          queue.add(newHeadBlock);

          return;
        }

        // Check if a reorg occurred by validating the chain of block hashes.
        if (newHeadBlock.parentHash !== latestLocalBlock.hash) {
          await handleReorg(service, newHeadBlock);
          queue.clear();
          return;
        }

        // New block is exactly one block ahead of the local chain.
        // Attempt to ingest it.
        await handleBlock(service, { newHeadBlock });

        // Reset the error state after successfully completing the happy path.
        service.consecutiveErrors = 0;

        return;
      } catch (_error) {
        if (service.isKilled) return;

        const error = _error as Error;
        error.stack = undefined;

        service.common.logger.warn({
          service: "realtime",
          msg: `Failed to process '${service.network.name}' block ${newHeadBlockNumber}`,
          error,
        });

        const duration = ERROR_TIMEOUT[service.consecutiveErrors]!;

        service.common.logger.warn({
          service: "realtime",
          msg: `Retrying '${service.network.name}' sync after ${duration} ${
            duration === 1 ? "second" : "seconds"
          }.`,
        });

        await wait(duration * 1_000);

        // Remove all blocks from the queue. This protects against an
        // erroneous block causing a fatal error.
        queue.clear();

        // After a certain number of attempts, emit a fatal error.
        if (++service.consecutiveErrors === ERROR_TIMEOUT.length) {
          service.common.logger.error({
            service: "realtime",
            msg: `Fatal error: Unable to process '${service.network.name}' block ${newHeadBlockNumber} after ${ERROR_TIMEOUT.length} attempts.`,
            error,
          });

          service.onFatalError(error);
        }
      }
    },
  });

  const enqueue = async () => {
    try {
      const block = await _eth_getBlockByNumber(service, {
        blockTag: "latest",
      });

      return queue.add(block);
    } catch (_error) {
      if (service.isKilled) return;

      const error = _error as Error;

      service.common.logger.warn({
        service: "realtime",
        msg: `Failed to fetch latest '${service.network.name}' block`,
        error,
      });
    }
  };

  setInterval(enqueue, service.network.pollingInterval);

  service.queue = queue;

  // Note: this is done just for testing.
  return enqueue().then(() => queue);
};

export const kill = async (service: Service) => {
  service.isKilled = true;
  service.queue?.pause();
  service.queue?.clear();

  service.common.logger.debug({
    service: "realtime",
    msg: `Killed '${service.network.name}' realtime sync`,
  });

  await service.queue?.onIdle();
};

/**
 * 1) Determine if a reorg occurred.
 * 2) Insert new event data into the store.
 * 3) Determine if a new range of events has become finalized,
 *    if so insert interval to store and remove the finalized data.
 *
 * @param newHeadBlock Block to be injested. Must be exactly
 * 1 block ahead of the local chain.
 * @returns true if a reorg occurred
 */
export const handleBlock = async (
  service: Service,
  { newHeadBlock }: { newHeadBlock: SyncBlock },
) => {
  const newHeadBlockNumber = hexToNumber(newHeadBlock.number);
  const newHeadBlockTimestamp = hexToNumber(newHeadBlock.timestamp);

  service.common.logger.debug({
    service: "realtime",
    msg: `Started syncing '${service.network.name}' block ${newHeadBlockNumber}`,
  });

  // "eth_getLogs" calls can be skipped if a negative match is given from "logsBloom".
  const shouldRequestLogs =
    service.factoryLogSources.length > 0 ||
    newHeadBlock.logsBloom === zeroLogsBloom ||
    isMatchedLogInBloomFilter({
      bloom: newHeadBlock.logsBloom,
      logFilters: service.logSources.map((s) => s.criteria),
    });
  const shouldRequestTraces =
    service.callTraceSources.length > 0 ||
    service.factoryCallTraceSources.length > 0;

  // Request logs
  const blockLogs = shouldRequestLogs
    ? await _eth_getLogs(service, { blockHash: newHeadBlock.hash })
    : [];
  const newLogs = await getMatchedLogs(service, {
    logs: blockLogs,
    upToBlockNumber: BigInt(newHeadBlockNumber),
  });

  // Protect against RPCs returning empty logs. Known to happen near chain tip.
  if (
    shouldRequestLogs &&
    newHeadBlock.logsBloom !== zeroLogsBloom &&
    blockLogs.length === 0
  ) {
    throw new Error(
      `Detected invalid '${service.network.name}' eth_getLogs response.`,
    );
  }

  if (
    shouldRequestLogs === false &&
    (service.logSources.length > 0 || service.factoryLogSources.length > 0)
  ) {
    service.common.logger.debug({
      service: "realtime",
      msg: `Skipped fetching logs for '${service.network.name}' block ${newHeadBlockNumber} due to bloom filter result`,
    });
  }

  // Request traces
  const blockTraces = shouldRequestTraces
    ? await _trace_block(service, {
        blockNumber: newHeadBlockNumber,
      })
    : [];
  const blockCallTraces = blockTraces.filter(
    (trace) => trace.type === "call",
  ) as SyncCallTrace[];
  const newCallTraces = await getMatchedCallTraces(service, {
    callTraces: blockCallTraces,
    logs: blockLogs,
    upToBlockNumber: BigInt(newHeadBlockNumber),
  });

  // Check that traces refer to the correct block
  for (const callTrace of newCallTraces) {
    if (callTrace.blockHash !== newHeadBlock.hash) {
      throw new Error(
        `Received call trace with block hash '${callTrace.blockHash}' that does not match current head block '${newHeadBlock.hash}'`,
      );
    }
  }

  // Protect against RPCs returning empty traces. Known to happen near chain tip.
  // Use the fact that any stateRoot change produces a trace.
  if (
    shouldRequestTraces &&
    newHeadBlock.transactions.length !== 0 &&
    blockTraces.length === 0
  ) {
    throw new Error(
      `Detected invalid '${service.network.name}' trace_block response.`,
    );
  }

  const transactionHashes = new Set<Hash>();
  for (const log of newLogs) {
    transactionHashes.add(log.transactionHash);
  }
  for (const callTrace of newCallTraces) {
    transactionHashes.add(callTrace.transactionHash);
  }

  const transactions = newHeadBlock.transactions.filter((t) =>
    transactionHashes.has(t.hash),
  );

  const newTransactionReceipts =
    service.hasTransactionReceiptSource || newCallTraces.length > 0
      ? await Promise.all(
          transactions.map(({ hash }) =>
            _eth_getTransactionReceipt(service, { hash }),
          ),
        )
      : [];

  // Filter out reverted call traces
  const revertedTransactions = new Set<Hash>();
  for (const receipt of newTransactionReceipts) {
    if (receipt.status === "0x0") {
      revertedTransactions.add(receipt.transactionHash);
    }
  }

  const newPersistentCallTraces = newCallTraces.filter(
    (trace) => revertedTransactions.has(trace.transactionHash) === false,
  );

  // Add pending event data to sync store and local event data. Ordering is
  // important because the sync store operation may throw an error, causing a retry.

  const hasLogEvent = newLogs.length > 0;
  const hasCallTraceEvent = newPersistentCallTraces.length > 0;
  const hasBlockEvent = service.blockSources.some(
    (blockSource) =>
      (newHeadBlockNumber - blockSource.criteria.offset) %
        blockSource.criteria.interval ===
      0,
  );

  if (hasLogEvent || hasCallTraceEvent || hasBlockEvent) {
    await service.syncStore.insertRealtimeBlock({
      chainId: service.network.chainId,
      block: newHeadBlock,
      transactions,
      transactionReceipts: newTransactionReceipts,
      logs: newLogs,
      traces: newPersistentCallTraces,
    });
  }

  if (hasLogEvent || hasCallTraceEvent) {
    const logCountText =
      newLogs.length === 1 ? "1 log" : `${newLogs.length} logs`;
    const traceCountText =
      newCallTraces.length === 1
        ? "1 call trace"
        : `${newCallTraces.length} call traces`;
    const text = [logCountText, traceCountText].join(" and ");
    service.common.logger.info({
      service: "realtime",
      msg: `Synced ${text} from '${service.network.name}' block ${newHeadBlockNumber}`,
    });
  } else if (hasBlockEvent) {
    service.common.logger.info({
      service: "realtime",
      msg: `Synced block ${newHeadBlockNumber} from '${service.network.name}' `,
    });
  }

  service.localChain.push(syncBlockToLightBlock(newHeadBlock));

  service.onEvent({
    type: "checkpoint",
    chainId: service.network.chainId,
    checkpoint: {
      ...maxCheckpoint,
      blockTimestamp: newHeadBlockTimestamp,
      chainId: BigInt(service.network.chainId),
      blockNumber: BigInt(newHeadBlockNumber),
    } satisfies Checkpoint,
  });

  service.common.metrics.ponder_realtime_latest_block_number.set(
    { network: service.network.name },
    newHeadBlockNumber,
  );
  service.common.metrics.ponder_realtime_latest_block_timestamp.set(
    { network: service.network.name },
    newHeadBlockTimestamp,
  );

  // Determine if a new range has become finalized by evaluating if the
  // latest block number is 2 * finalityBlockCount >= finalized block number.
  // Essentially, there is a range the width of finalityBlockCount that is entirely
  // finalized.
  const blockMovesFinality =
    newHeadBlockNumber >=
    service.finalizedBlock.number + 2 * service.network.finalityBlockCount;
  if (blockMovesFinality) {
    const pendingFinalizedBlock = service.localChain.find(
      (block) =>
        block.number ===
        newHeadBlockNumber - service.network.finalityBlockCount,
    )!;

    // Insert cache intervals into the store and update the local chain.
    // Ordering is important here because the database query can fail.
    await service.syncStore.insertRealtimeInterval({
      chainId: service.network.chainId,
      logFilters: service.logSources.map((l) => l.criteria),
      factoryLogFilters: service.factoryLogSources.map((f) => f.criteria),
      blockFilters: service.blockSources.map((b) => b.criteria),
      traceFilters: service.callTraceSources.map((f) => f.criteria),
      factoryTraceFilters: service.factoryCallTraceSources.map(
        (f) => f.criteria,
      ),
      interval: {
        startBlock: BigInt(service.finalizedBlock.number + 1),
        endBlock: BigInt(pendingFinalizedBlock.number),
      },
    });

    service.common.logger.debug({
      service: "realtime",
      msg: `Finalized ${pendingFinalizedBlock.number - service.finalizedBlock.number + 1} '${
        service.network.name
      }' blocks from ${service.finalizedBlock.number + 1} to ${pendingFinalizedBlock.number}`,
    });

    service.localChain = service.localChain.filter(
      (block) => block.number > pendingFinalizedBlock.number,
    );

    service.finalizedBlock = pendingFinalizedBlock;

    service.onEvent({
      type: "finalize",
      chainId: service.network.chainId,
      checkpoint: {
        ...maxCheckpoint,
        blockTimestamp: service.finalizedBlock.timestamp,
        chainId: BigInt(service.network.chainId),
        blockNumber: BigInt(service.finalizedBlock.number),
      } satisfies Checkpoint,
    });
  }

  service.common.logger.debug({
    service: "realtime",
    msg: `Finished syncing '${service.network.name}' block ${newHeadBlockNumber}`,
  });
};

/**
 * Traverse the remote chain until we find a block that is
 * compatible with out local chain.
 *
 * @param newHeadBlock Block that caused reorg to be detected.
 * Must be at most 1 block ahead of the local chain.
 */
export const handleReorg = async (
  service: Service,
  newHeadBlock: SyncBlock,
) => {
  const forkedBlockNumber = hexToNumber(newHeadBlock.number);

  service.common.logger.warn({
    service: "realtime",
    msg: `Detected forked '${service.network.name}' block at height ${forkedBlockNumber}`,
  });

  // Prune the local chain of blocks that have been reorged out
  const newLocalChain = service.localChain.filter(
    (block) => block.number < forkedBlockNumber,
  );

  // Block we are attempting to fit into the local chain.
  let remoteBlock = newHeadBlock;

  while (true) {
    const parentBlock = getLatestLocalBlock({
      localChain: newLocalChain,
      finalizedBlock: service.finalizedBlock,
    });

    if (parentBlock.hash === remoteBlock.parentHash) {
      await service.syncStore.deleteRealtimeData({
        chainId: service.network.chainId,
        fromBlock: BigInt(parentBlock.number),
      });

      service.localChain = newLocalChain;

      service.onEvent({
        type: "reorg",
        chainId: service.network.chainId,
        safeCheckpoint: {
          ...maxCheckpoint,
          blockTimestamp: parentBlock.timestamp,
          chainId: BigInt(service.network.chainId),
          blockNumber: BigInt(parentBlock.number),
        },
      });

      service.common.logger.warn({
        service: "realtime",
        msg: `Reconciled ${forkedBlockNumber - parentBlock.number}-block reorg on '${
          service.network.name
        }' with common ancestor block ${parentBlock.number}`,
      });

      return;
    }

    if (newLocalChain.length === 0) break;
    else {
      remoteBlock = await _eth_getBlockByHash(service, {
        blockHash: remoteBlock.parentHash,
      });
      newLocalChain.pop();
    }
  }

  // No compatible block was found in the local chain, must be a deep reorg.

  const msg = `Encountered unrecoverable '${service.network.name}' reorg beyond finalized block ${service.finalizedBlock.number}`;

  service.common.logger.warn({ service: "realtime", msg });

  service.localChain = [];

  throw new Error(msg);
};

/**
 * Find the most recent block that is less than or equal to
 * the provided checkpoint.
 */
export const getMostRecentBlock = (
  service: Service,
  checkpoint: Checkpoint,
): LightBlock | undefined => {
  const localBlock = service.localChain.findLast(
    (block) => block.timestamp <= checkpoint.blockTimestamp,
  );

  if (localBlock !== undefined) return localBlock;

  if (service.finalizedBlock.timestamp < checkpoint.blockTimestamp)
    return service.finalizedBlock;

  return undefined;
};

const getMatchedLogs = async (
  service: Service,
  {
    logs,
    upToBlockNumber,
  }: {
    logs: SyncLog[];
    upToBlockNumber: bigint;
  },
) => {
  if (service.factoryLogSources.length === 0) {
    return filterLogs({
      logs,
      logFilters: service.logSources.map((s) => s.criteria),
    });
  } else {
    // Find and insert any new child contracts.
    const matchedFactoryLogs = filterLogs({
      logs,
      logFilters: service.factoryLogSources.map((fs) => ({
        address: fs.criteria.address,
        topics: [fs.criteria.eventSelector],
      })),
    });

    await service.syncStore.insertFactoryChildAddressLogs({
      chainId: service.network.chainId,
      logs: matchedFactoryLogs,
    });

    // Find any logs matching log filters or child contract filters.
    // NOTE: It might make sense to just insert all logs rather than introduce
    // a potentially slow DB operation here. It's a tradeoff between sync
    // latency and database growth.
    // NOTE: Also makes sense to hold factoryChildAddresses in memory rather than
    // a query each interval.
    const factoryLogFilters = await Promise.all(
      service.factoryLogSources.map(async (factory) => {
        const iterator = service.syncStore.getFactoryChildAddresses({
          chainId: service.network.chainId,
          factory: factory.criteria,
          fromBlock: BigInt(factory.startBlock),
          toBlock: upToBlockNumber,
        });
        const childContractAddresses: Address[] = [];
        for await (const batch of iterator) {
          childContractAddresses.push(...batch);
        }
        return {
          address: childContractAddresses,
          topics: factory.criteria.topics,
        };
      }),
    );

    return filterLogs({
      logs,
      logFilters: [
        ...service.logSources.map((l) => l.criteria),
        ...factoryLogFilters.filter((f) => f.address.length !== 0),
      ],
    });
  }
};

const getMatchedCallTraces = async (
  service: Service,
  {
    callTraces,
    logs,
    upToBlockNumber,
  }: {
    callTraces: SyncCallTrace[];
    logs: SyncLog[];
    upToBlockNumber: bigint;
  },
) => {
  if (service.factoryCallTraceSources.length === 0) {
    return filterCallTraces({
      callTraces,
      callTraceFilters: service.callTraceSources.map((s) => s.criteria),
    });
  } else {
    // Find and insert any new child contracts.
    const matchedFactoryLogs = filterLogs({
      logs,
      logFilters: service.factoryLogSources.map((fs) => ({
        address: fs.criteria.address,
        topics: [fs.criteria.eventSelector],
      })),
    });

    await service.syncStore.insertFactoryChildAddressLogs({
      chainId: service.network.chainId,
      logs: matchedFactoryLogs,
    });

    // Find any logs matching log filters or child contract filters.
    // NOTE: It might make sense to just insert all logs rather than introduce
    // a potentially slow DB operation here. It's a tradeoff between sync
    // latency and database growth.
    // NOTE: Also makes sense to hold factoryChildAddresses in memory rather than
    // a query each interval.
    const factoryTraceFilters = await Promise.all(
      service.factoryCallTraceSources.map(async (factory) => {
        const iterator = service.syncStore.getFactoryChildAddresses({
          chainId: service.network.chainId,
          factory: factory.criteria,
          fromBlock: BigInt(factory.startBlock),
          toBlock: upToBlockNumber,
        });
        const childContractAddresses: Address[] = [];
        for await (const batch of iterator) {
          childContractAddresses.push(...batch);
        }
        return {
          toAddress: childContractAddresses,
          fromAddress: factory.criteria.fromAddress,
        };
      }),
    );

    return filterCallTraces({
      callTraces,
      callTraceFilters: [
        ...service.callTraceSources.map((s) => s.criteria),
        ...factoryTraceFilters.filter((f) => f.toAddress.length !== 0),
      ],
    });
  }
};

const getLatestLocalBlock = ({
  localChain,
  finalizedBlock,
}: Pick<Service, "localChain" | "finalizedBlock">) => {
  if (localChain.length === 0) {
    return finalizedBlock;
  } else return localChain[localChain.length - 1]!;
};
