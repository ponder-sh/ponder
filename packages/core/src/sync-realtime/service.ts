import type { Common } from "@/common/common.js";
import type { Network } from "@/config/networks.js";
import {
  type EventSource,
  type FactorySource,
  type LogSource,
  sourceIsFactory,
  sourceIsLog,
} from "@/config/sources.js";
import type { SyncStore } from "@/sync-store/store.js";
import {
  type SyncBlock,
  type SyncLog,
  _eth_getBlockByHash,
  _eth_getBlockByNumber,
  _eth_getLogs,
} from "@/sync/index.js";
import { type Checkpoint, maxCheckpoint } from "@/utils/checkpoint.js";
import { range } from "@/utils/range.js";
import type { RequestQueue } from "@/utils/requestQueue.js";
import { wait } from "@/utils/wait.js";
import { createQueue } from "@ponder/common";
import { type Address, type Hex, hexToNumber } from "viem";
import { isMatchedLogInBloomFilter, zeroLogsBloom } from "./bloom.js";
import { filterLogs } from "./filter.js";
import {
  type LightBlock,
  type LightLog,
  sortLogs,
  syncBlockToLightBlock,
  syncLogToLightLog,
} from "./format.js";

export type RealtimeSyncService = {
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
  localChain: LocalBlockchainState[];
  kill: () => Promise<void>;

  // callbacks
  onEvent: (event: RealtimeSyncEvent) => void;
  onFatalError: (error: Error) => void;

  // derived static
  /** List of all possible event selectors based on the provided `sources`. */
  eventSelectors: Hex[];
  hasFactorySource: boolean;
  logFilterSources: LogSource[];
  factorySources: FactorySource[];
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
    };

type LocalBlockchainState = {
  block: LightBlock;
  logs: LightLog[];
};

export const createRealtimeSyncService = ({
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
}): RealtimeSyncService => {
  // get event selectors from sources
  const eventSelectors = sources.flatMap((source) => {
    const topics: Hex[] = [];

    if (sourceIsFactory(source)) {
      topics.push(source.criteria.eventSelector);
    }

    const topic0 = source.criteria.topics?.[0];
    if (topic0 !== undefined && topic0 !== null) {
      if (Array.isArray(topic0)) topics.push(...topic0);
      else topics.push(topic0);
    }
    return topics;
  });

  return {
    common,
    syncStore,
    network,
    requestQueue,
    sources,
    isKilled: false,
    finalizedBlock: syncBlockToLightBlock(finalizedBlock),
    localChain: [],
    kill: () => Promise.resolve(),
    onEvent,
    onFatalError,
    eventSelectors,
    hasFactorySource: sources.some(sourceIsFactory),
    logFilterSources: sources.filter(sourceIsLog),
    factorySources: sources.filter(sourceIsFactory),
  };
};

export const startRealtimeSyncService = (
  realtimeSyncService: RealtimeSyncService,
) => {
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
    worker: async (newBlock: SyncBlock) => {
      const latestLocalBlock = getLatestLocalBlock(realtimeSyncService);
      const newBlockNumber = hexToNumber(newBlock.number);

      // We already saw and handled this block. No-op.
      if (latestLocalBlock.hash === newBlock.hash) {
        realtimeSyncService.common.logger.trace({
          service: "realtime",
          msg: `Already processed block at ${newBlockNumber} (network=${realtimeSyncService.network.name})`,
        });

        return;
      }

      for (let i = 0; i < 6; i++) {
        try {
          // Quickly check for a reorg by comparing block numbers. If the block
          // number has not increased, a reorg must have occurred.
          if (latestLocalBlock.number >= newBlockNumber) {
            await handleReorg(realtimeSyncService, newBlock);

            if (realtimeSyncService.isKilled) return;

            queue.clear();
            queue.add(newBlock);
            return;
          }

          // Blocks are missing. They should be fetched and enqueued.
          if (latestLocalBlock.number + 1 < newBlockNumber) {
            // Retrieve missing blocks
            const missingBlockRange = range(
              latestLocalBlock.number + 1,
              newBlockNumber,
            );
            const pendingBlocks = await Promise.all(
              missingBlockRange.map((blockNumber) =>
                _eth_getBlockByNumber(realtimeSyncService, { blockNumber }),
              ),
            );

            if (realtimeSyncService.isKilled) return;

            queue.clear();

            for (const pendingBlock of pendingBlocks) {
              queue.add(pendingBlock);
            }

            queue.add(newBlock);

            return;
          }

          // New block is exactly one block ahead of the local chain.
          // Attempt to ingest it.
          const hasReorg = await handleBlock(realtimeSyncService, {
            pendingLatestBlock: newBlock,
          });

          if (realtimeSyncService.isKilled) return;

          if (hasReorg) {
            queue.clear();
            queue.add(newBlock);
          }

          return;
        } catch (_error) {
          if (realtimeSyncService.isKilled) return;

          const error = _error as Error;

          realtimeSyncService.common.logger.warn({
            service: "realtime",
            msg: `Realtime sync task failed (network=${
              realtimeSyncService.network.name
            }, error=${`${error.name}: ${error.message}`})`,
          });

          if (i === 5) realtimeSyncService.onFatalError(error);
          else await wait(250 * 2 ** i);
        }
      }
    },
  });

  const enqueue = () =>
    _eth_getBlockByNumber(realtimeSyncService, {
      blockTag: "latest",
    }).then(queue.add);

  const interval = setInterval(
    enqueue,
    realtimeSyncService.network.pollingInterval,
  );

  realtimeSyncService.kill = async () => {
    realtimeSyncService.isKilled = true;
    clearInterval(interval);
    queue.pause();
    queue.clear();

    await queue.onIdle();
  };

  // Note: this is done just for testing.
  return enqueue().then(() => queue);
};

/**
 * 1) Determine if a reorg occurred.
 * 2) Insert new event data into the store.
 * 3) Determine if a new range of events has become finalized,
 *    if so validate the local chain before removing the
 *    finalized data.
 *
 * @param pendingLatestBlock Block to be injested. Must be exactly
 * 1 block ahead of the local chain.
 * @returns true if a reorg occurred
 */
export const handleBlock = async (
  realtimeSyncService: RealtimeSyncService,
  { pendingLatestBlock }: { pendingLatestBlock: SyncBlock },
) => {
  const pendingLatestBlockNumber = hexToNumber(pendingLatestBlock.number);
  const pendingLatestBlockTimestamp = hexToNumber(pendingLatestBlock.timestamp);
  const latestLocalBlock = getLatestLocalBlock(realtimeSyncService);
  realtimeSyncService.common.logger.debug({
    service: "realtime",
    msg: `Syncing new block ${pendingLatestBlockNumber} (network=${realtimeSyncService.network.name})`,
  });

  // Check if a reorg occurred by validating the chain of block hashes.
  if (pendingLatestBlock.parentHash !== latestLocalBlock.hash) {
    await handleReorg(realtimeSyncService, pendingLatestBlock);
    return true;
  }

  let pendingLogs: SyncLog[] = [];

  // "eth_getLogs" calls can be skipped if a negative match is given from "logsBloom".
  const mustRequestGetLogs =
    realtimeSyncService.hasFactorySource ||
    pendingLatestBlock.logsBloom === zeroLogsBloom ||
    isMatchedLogInBloomFilter({
      bloom: pendingLatestBlock.logsBloom,
      logFilters: realtimeSyncService.sources.map((s) => s.criteria),
    });

  if (mustRequestGetLogs) {
    const logs = await _eth_getLogs(realtimeSyncService, {
      topics: [realtimeSyncService.eventSelectors],
      blockHash: pendingLatestBlock.hash,
    });

    pendingLogs = await getMatchedLogs(realtimeSyncService, {
      logs,
      insertChildAddressLogs: true,
      upToBlockNumber: BigInt(pendingLatestBlockNumber),
    });
  } else {
    realtimeSyncService.common.logger.debug({
      service: "realtime",
      msg: `Skipping eth_getLogs call because of logs bloom filter result (network=${realtimeSyncService.network.name}`,
    });
  }

  // Add pending event data to sync store and local event data. Ordering is
  // important because the sync store operation may throw an error, causing a retry.
  const transactionHashes = new Set(pendingLogs.map((l) => l.transactionHash));
  const transactions = pendingLatestBlock.transactions.filter((t) =>
    transactionHashes.has(t.hash),
  );

  if (pendingLogs.length > 0) {
    await realtimeSyncService.syncStore.insertRealtimeBlock({
      chainId: realtimeSyncService.network.chainId,
      block: pendingLatestBlock,
      transactions,
      logs: pendingLogs,
    });

    const matchedLogCountText =
      pendingLogs.length === 1
        ? "1 matched log"
        : `${pendingLogs.length} matched logs`;
    realtimeSyncService.common.logger.info({
      service: "realtime",
      msg: `Synced ${matchedLogCountText} from block ${pendingLatestBlockNumber} (network=${realtimeSyncService.network.name})`,
    });

    realtimeSyncService.onEvent({
      type: "checkpoint",
      chainId: realtimeSyncService.network.chainId,
      checkpoint: {
        ...maxCheckpoint,
        blockTimestamp: pendingLatestBlockTimestamp,
        chainId: realtimeSyncService.network.chainId,
        blockNumber: pendingLatestBlockNumber,
      } as Checkpoint,
    });
  } else {
    realtimeSyncService.common.logger.info({
      service: "realtime",
      msg: `Synced 0 matched logs from block ${pendingLatestBlockNumber} (network=${realtimeSyncService.network.name})`,
    });
  }

  realtimeSyncService.localChain.push({
    block: syncBlockToLightBlock(pendingLatestBlock),
    logs: pendingLogs.map(syncLogToLightLog),
  });

  realtimeSyncService.common.metrics.ponder_realtime_latest_block_number.set(
    { network: realtimeSyncService.network.name },
    pendingLatestBlockNumber,
  );
  realtimeSyncService.common.metrics.ponder_realtime_latest_block_timestamp.set(
    { network: realtimeSyncService.network.name },
    pendingLatestBlockTimestamp,
  );

  // Determine if a new range has become finalized by evaluating if the
  // latest block number is 2 * finalityBlockCount >= finalized block number.
  // Essentially, there is a range the width of finalityBlockCount that is entirely
  // finalized.
  const blockMovesFinality =
    pendingLatestBlockNumber >=
    realtimeSyncService.finalizedBlock.number +
      2 * realtimeSyncService.network.finalityBlockCount;
  if (blockMovesFinality) {
    const pendingFinalizedBlock = realtimeSyncService.localChain.find(
      ({ block }) =>
        block.number ===
        pendingLatestBlockNumber -
          realtimeSyncService.network.finalityBlockCount,
    )!.block;

    // Validate the local chain by re-requesting logs and checking for inconsistencies
    // between the local and recently fetched data. This is neccessary because
    // degraded rpc providers have trouble indexing logs near the tip of the chain.
    const hasInvalidLogs = await validateLocalBlockchainState(
      realtimeSyncService,
      pendingFinalizedBlock,
    );

    if (hasInvalidLogs) {
      realtimeSyncService.common.logger.warn({
        service: "realtime",
        msg: `Detected inconsistency between local and remote logs in block range ${
          realtimeSyncService.finalizedBlock.number + 1
        } to ${pendingFinalizedBlock.number} (network=${
          realtimeSyncService.network.name
        })`,
      });
    }

    realtimeSyncService.localChain = realtimeSyncService.localChain.filter(
      ({ block }) => block.number > pendingFinalizedBlock.number,
    );

    // TODO: Update this to insert:
    // 1) Log filter intervals
    // 2) Factory contract intervals
    // 3) Child filter intervals
    await realtimeSyncService.syncStore.insertRealtimeInterval({
      chainId: realtimeSyncService.network.chainId,
      logFilters: realtimeSyncService.logFilterSources.map((l) => l.criteria),
      factories: realtimeSyncService.factorySources.map((f) => f.criteria),
      interval: {
        startBlock: BigInt(realtimeSyncService.finalizedBlock.number + 1),
        endBlock: BigInt(pendingFinalizedBlock.number),
      },
    });

    realtimeSyncService.finalizedBlock = pendingFinalizedBlock;

    // Note: This is where a finalization event would happen.

    realtimeSyncService.common.logger.debug({
      service: "realtime",
      msg: `Updated finality to block ${pendingFinalizedBlock.number} (network=${realtimeSyncService.network.name})`,
    });
  }

  realtimeSyncService.common.logger.debug({
    service: "realtime",
    msg: `Finished syncing new head block ${pendingLatestBlockNumber} (network=${realtimeSyncService.network.name})`,
  });

  return false;
};

/**
 * Traverse the remote chain until we find a block that is
 * compatible with out local chain.
 *
 * @param pendingLatestBlock Block that caused reorg to be detected.
 * Must be at most 1 block ahead of the local chain.
 */
export const handleReorg = async (
  realtimeSyncService: RealtimeSyncService,
  pendingLatestBlock: SyncBlock,
) => {
  // Prune the local chain of blocks that have been reorged out
  realtimeSyncService.localChain = realtimeSyncService.localChain.filter(
    ({ block }) => block.number < hexToNumber(pendingLatestBlock.number),
  );

  // Block we are attempting to fit into the local chain.
  let reorgedBlock = pendingLatestBlock;

  while (true) {
    const parentBlock = getLatestLocalBlock(realtimeSyncService);

    if (parentBlock.hash === reorgedBlock.parentHash) {
      realtimeSyncService.common.logger.trace({
        service: "realtime",
        msg: `Found common ancestor block ${parentBlock.number} (network=${realtimeSyncService.network.name})`,
      });

      await realtimeSyncService.syncStore.deleteRealtimeData({
        chainId: realtimeSyncService.network.chainId,
        fromBlock: BigInt(parentBlock.number),
      });

      realtimeSyncService.onEvent({
        type: "reorg",
        chainId: realtimeSyncService.network.chainId,
        safeCheckpoint: {
          ...maxCheckpoint,
          blockTimestamp: parentBlock.timestamp,
          chainId: realtimeSyncService.network.chainId,
          blockNumber: parentBlock.number,
        },
      });

      realtimeSyncService.common.logger.warn({
        service: "realtime",
        msg: `Detected reorg with common ancestor ${parentBlock.number} (network=${realtimeSyncService.network.name})`,
      });

      return;
    }

    if (realtimeSyncService.localChain.length === 0) break;
    else {
      reorgedBlock = await _eth_getBlockByHash(realtimeSyncService, {
        blockHash: reorgedBlock.parentHash,
      });
      realtimeSyncService.localChain.pop();
    }
  }

  // No compatible block was found in the local chain, must be a deep reorg.

  const msg = `Detected unrecoverable reorg at block ${realtimeSyncService.finalizedBlock.number} (network=${realtimeSyncService.network.name})`;

  realtimeSyncService.common.logger.warn({ service: "realtime", msg });
  realtimeSyncService.onFatalError(new Error(msg));

  realtimeSyncService.localChain = [];
};

const getMatchedLogs = async (
  realtimeSyncService: RealtimeSyncService,
  {
    logs,
    insertChildAddressLogs,
    upToBlockNumber,
  }: {
    logs: SyncLog[];
    insertChildAddressLogs: boolean;
    upToBlockNumber: bigint;
  },
) => {
  if (realtimeSyncService.hasFactorySource === false) {
    return filterLogs({
      logs,
      logFilters: realtimeSyncService.sources.map((s) => s.criteria),
    });
  } else {
    if (insertChildAddressLogs) {
      // Find and insert any new child contracts.
      const matchedFactoryLogs = filterLogs({
        logs,
        logFilters: realtimeSyncService.factorySources.map((fs) => ({
          address: fs.criteria.address,
          topics: [fs.criteria.eventSelector],
        })),
      });

      await realtimeSyncService.syncStore.insertFactoryChildAddressLogs({
        chainId: realtimeSyncService.network.chainId,
        logs: matchedFactoryLogs,
      });
    }

    // Find any logs matching log filters or child contract filters.
    // NOTE: It might make sense to just insert all logs rather than introduce
    // a potentially slow DB operation here. It's a tradeoff between sync
    // latency and database growth.
    // NOTE: Also makes sense to hold factoryChildAddresses in memory rather than
    // a query each interval.
    const factoryLogFilters = await Promise.all(
      realtimeSyncService.factorySources.map(async (factory) => {
        const iterator = realtimeSyncService.syncStore.getFactoryChildAddresses(
          {
            chainId: realtimeSyncService.network.chainId,
            factory: factory.criteria,
            upToBlockNumber,
          },
        );
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
        ...realtimeSyncService.logFilterSources.map((l) => l.criteria),
        ...factoryLogFilters,
      ],
    });
  }
};

export const validateLocalBlockchainState = async (
  realtimeSyncService: RealtimeSyncService,
  pendingFinalizedBlock: LightBlock,
) => {
  realtimeSyncService.common.logger.debug({
    service: "realtime",
    msg: `Validating local chain from block ${
      realtimeSyncService.finalizedBlock.number + 1
    } to ${pendingFinalizedBlock.number} (network=${
      realtimeSyncService.network.name
    })`,
  });

  const logs = await _eth_getLogs(realtimeSyncService, {
    fromBlock: realtimeSyncService.finalizedBlock.number + 1,
    toBlock: pendingFinalizedBlock.number,
  }).then(sortLogs);

  const remoteLogs = await getMatchedLogs(realtimeSyncService, {
    logs,
    insertChildAddressLogs: false,
    upToBlockNumber: BigInt(pendingFinalizedBlock.number),
  });

  const localLogs = sortLogs(
    realtimeSyncService.localChain
      .filter(({ block }) => block.number <= pendingFinalizedBlock.number)
      .flatMap(({ logs }) => logs),
  );

  for (let i = 0; i < localLogs.length && i < remoteLogs.length; i++) {
    if (
      remoteLogs[i].blockHash !== localLogs[i].blockHash ||
      remoteLogs[i].logIndex !== localLogs[i].logIndex
    ) {
      return true;
    }
  }

  if (localLogs.length !== remoteLogs.length) {
    return true;
  }

  return false;
};

const getLatestLocalBlock = ({
  localChain,
  finalizedBlock,
}: Pick<RealtimeSyncService, "localChain" | "finalizedBlock">) => {
  if (localChain.length === 0) {
    return finalizedBlock;
  } else return localChain[localChain.length - 1].block;
};
