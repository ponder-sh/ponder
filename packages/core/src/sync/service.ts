import type { RealtimeEvent } from "@/bin/utils/run.js";
import type { Common } from "@/common/common.js";
import type { Network } from "@/config/networks.js";
import type { EventSource } from "@/config/sources.js";
import { HistoricalSyncService } from "@/sync-historical/service.js";
import {
  type RealtimeSyncEvent,
  type RealtimeSyncService,
  createRealtimeSyncService,
} from "@/sync-realtime/index.js";
import type { SyncStore } from "@/sync-store/store.js";
import {
  type Checkpoint,
  checkpointMax,
  checkpointMin,
  isCheckpointGreaterThan,
  maxCheckpoint,
  zeroCheckpoint,
} from "@/utils/checkpoint.js";
import { never } from "@/utils/never.js";
import { type RequestQueue, createRequestQueue } from "@/utils/requestQueue.js";
import { wait } from "@/utils/wait.js";
import { type Transport, hexToBigInt, hexToNumber } from "viem";
import { type SyncBlock, _eth_getBlockByNumber } from "./index.js";
import { cachedTransport } from "./transport.js";

export type Service = {
  // static
  common: Common;
  syncStore: SyncStore;
  sources: EventSource[];

  // state
  checkpoint: Checkpoint;
  /** Checkpoint of the earliest start block. */
  startCheckpoint: Checkpoint;
  /**
   * Checkpoint of the latest end block, can
   * be undefined if not every end block is set.
   */
  endCheckpoint: Checkpoint | undefined;
  finalizedCheckpoint: Checkpoint;
  isKilled: boolean;

  // network specific services
  networkServices: {
    network: Network;
    sources: EventSource[];
    requestQueue: RequestQueue;
    cachedTransport: Transport;

    startCheckpoint: Checkpoint;
    endCheckpoint: Checkpoint | undefined;
    initialFinalizedCheckpoint: Checkpoint;

    realtime:
      | {
          realtimeSync: RealtimeSyncService;
          checkpoint: Checkpoint;
          finalizedCheckpoint: Checkpoint;
          finalizedBlock: SyncBlock;
          endBlock: number | undefined;
        }
      | undefined;

    historical: {
      historicalSync: HistoricalSyncService;
      checkpoint: Checkpoint | undefined;
      isHistoricalSyncComplete: boolean;
    };
  }[];

  // cache
  sourceById: { [sourceId: EventSource["id"]]: EventSource };
};

const HISTORICAL_CHECKPOINT_INTERVAL = 500;

export const create = async ({
  common,
  syncStore,
  networks,
  sources,
  onRealtimeEvent,
  onFatalError,
  initialCheckpoint,
}: {
  common: Common;
  syncStore: SyncStore;
  networks: Network[];
  sources: EventSource[];
  onRealtimeEvent: (realtimeEvent: RealtimeEvent) => void;
  onFatalError: (error: Error) => void;
  initialCheckpoint: Checkpoint;
}): Promise<Service> => {
  const sourceById = sources.reduce<Service["sourceById"]>((acc, cur) => {
    acc[cur.id] = cur;
    return acc;
  }, {});

  const onRealtimeSyncEvent = (realtimeSyncEvent: RealtimeSyncEvent) => {
    switch (realtimeSyncEvent.type) {
      case "checkpoint": {
        const networkService = syncService.networkServices.find(
          (ns) => ns.network.chainId === realtimeSyncEvent.chainId,
        )!;

        // "realtime" property may be undefined when `kill()` has been
        // invoked but hasn't completed.
        if (networkService.realtime === undefined) return;

        networkService.realtime.checkpoint = realtimeSyncEvent.checkpoint;

        // `realtime` can be undefined if no contracts for that network require a realtime
        // service. Those networks can be left out of the checkpoint calculation.
        const newCheckpoint = checkpointMin(
          ...syncService.networkServices
            .filter((ns) => ns.realtime !== undefined)
            .map((ns) => ns.realtime!.checkpoint),
        );

        // Do nothing if the checkpoint hasn't advanced. This also protects against
        // edged cases in the caching logic with un-trustworthy finalized checkpoints.
        if (!isCheckpointGreaterThan(newCheckpoint, syncService.checkpoint))
          return;

        // Must be cautious to deep copy checkpoints.

        const fromCheckpoint = { ...syncService.checkpoint };
        const toCheckpoint = { ...newCheckpoint };

        syncService.checkpoint = newCheckpoint;

        onRealtimeEvent({
          type: "newEvents",
          fromCheckpoint,
          toCheckpoint,
        });

        break;
      }

      case "reorg": {
        const networkService = syncService.networkServices.find(
          (ns) => ns.network.chainId === realtimeSyncEvent.chainId,
        )!;

        // "realtime" property may be undefined when `kill()` has been
        // invoked but hasn't completed.
        if (networkService.realtime === undefined) return;

        networkService.realtime!.checkpoint = realtimeSyncEvent.safeCheckpoint;

        if (
          isCheckpointGreaterThan(
            syncService.checkpoint,
            realtimeSyncEvent.safeCheckpoint,
          )
        ) {
          syncService.checkpoint = realtimeSyncEvent.safeCheckpoint;
        }

        onRealtimeEvent(realtimeSyncEvent);

        break;
      }

      case "finalize": {
        const networkService = syncService.networkServices.find(
          (ns) => ns.network.chainId === realtimeSyncEvent.chainId,
        )!;

        // "realtime" property may be undefined when `kill()` has been
        // invoked but hasn't completed.
        if (networkService.realtime === undefined) return;

        networkService.realtime!.finalizedCheckpoint =
          realtimeSyncEvent.checkpoint;

        // Check if the finalized blockNumber is greater than the end block of all
        // sources for the network. Potentially kill the realtime sync and remove the
        // network from checkpoint calculations.
        if (
          networkService.realtime.endBlock !== undefined &&
          realtimeSyncEvent.checkpoint.blockNumber >
            networkService.realtime.endBlock
        ) {
          common.logger.info({
            service: "sync",
            msg: `Synced final end block for '${networkService.network.name}' (${networkService.realtime.endBlock}), killing realtime sync service`,
          });
          networkService.realtime.realtimeSync.kill();
          networkService.realtime = undefined;
        }

        const newFinalizedCheckpoint = checkpointMin(
          ...syncService.networkServices
            .filter((ns) => ns.realtime !== undefined)
            .map((ns) => ns.realtime!.finalizedCheckpoint),
        );

        if (
          isCheckpointGreaterThan(
            newFinalizedCheckpoint,
            syncService.finalizedCheckpoint,
          )
        ) {
          onRealtimeEvent({
            type: "finalize",
            checkpoint: newFinalizedCheckpoint,
          });
          syncService.finalizedCheckpoint = newFinalizedCheckpoint;
        }

        break;
      }

      default:
        never(realtimeSyncEvent);
    }
  };

  const networkServices: Service["networkServices"] = await Promise.all(
    networks.map(async (network) => {
      const networkSources = sources.filter(
        (source) => source.networkName === network.name,
      );

      const requestQueue = createRequestQueue({
        network,
        common,
      });

      const hasEndBlock = networkSources.every(
        (source) => source.endBlock !== undefined,
      );

      const [
        startBlock,
        endBlock,
        { latestBlock, finalizedBlock },
        remoteChainId,
      ] = await Promise.all([
        _eth_getBlockByNumber(
          { requestQueue },
          {
            blockNumber: Math.min(
              ...networkSources.map((source) => source.startBlock),
            ),
          },
        ),
        hasEndBlock
          ? _eth_getBlockByNumber(
              { requestQueue },
              {
                blockNumber: Math.max(
                  ...networkSources.map((source) => source.endBlock!),
                ),
              },
            )
          : undefined,
        getLatestAndFinalizedBlocks({
          network,
          requestQueue,
        }),
        requestQueue.request({ method: "eth_chainId" }).then(hexToNumber),
      ]);

      if (network.chainId !== remoteChainId) {
        common.logger.warn({
          service: "sync",
          msg: `Remote chain ID (${remoteChainId}) does not match configured chain ID (${network.chainId}) for network "${network.name}"`,
        });
      }

      for (const source of networkSources) {
        if (source.startBlock > hexToNumber(latestBlock.number)) {
          common.logger.warn({
            service: "sync",
            msg: `Start block ${source.startBlock} is greater than the latest block ${hexToNumber(
              latestBlock.number,
            )} for '${network.name}'.`,
          });
        }
      }

      const historicalSync = new HistoricalSyncService({
        common,
        syncStore,
        network,
        requestQueue,
        sources: networkSources,
      });

      await historicalSync.setup({
        finalizedBlockNumber: hexToNumber(finalizedBlock.number),
      });

      const initialFinalizedCheckpoint: Checkpoint = {
        ...maxCheckpoint,
        blockTimestamp: hexToNumber(finalizedBlock.timestamp),
        chainId: BigInt(network.chainId),
        blockNumber: hexToBigInt(finalizedBlock.number),
      };

      const startCheckpoint = {
        ...zeroCheckpoint,
        blockTimestamp: hexToNumber(startBlock.timestamp),
        blockNumber: hexToBigInt(startBlock.number),
        chainId: BigInt(network.chainId),
      };

      const endCheckpoint = endBlock
        ? {
            ...zeroCheckpoint,
            blockTimestamp: hexToNumber(endBlock.timestamp),
            blockNumber: hexToBigInt(endBlock.number),
            chainId: BigInt(network.chainId),
          }
        : undefined;

      const canSkipRealtime = getCanSkipRealtime({
        sources: networkSources,
        finalizedBlock,
      });

      if (canSkipRealtime) {
        return {
          network,
          sources: networkSources,
          requestQueue,
          cachedTransport: cachedTransport({ requestQueue, syncStore }),
          startCheckpoint,
          endCheckpoint,
          initialFinalizedCheckpoint,
          realtime: undefined,
          historical: {
            historicalSync,
            checkpoint: undefined,
            isHistoricalSyncComplete: false,
          },
        } satisfies Service["networkServices"][number];
      } else {
        const realtimeSync = createRealtimeSyncService({
          common,
          syncStore,
          network,
          requestQueue,
          sources: networkSources,
          finalizedBlock,
          onEvent: onRealtimeSyncEvent,
          onFatalError,
        });

        return {
          network,
          sources: networkSources,
          requestQueue,
          cachedTransport: cachedTransport({ requestQueue, syncStore }),
          startCheckpoint,
          endCheckpoint,
          initialFinalizedCheckpoint,
          realtime: {
            realtimeSync,
            checkpoint: initialFinalizedCheckpoint,
            finalizedCheckpoint: initialFinalizedCheckpoint,
            finalizedBlock,
            endBlock: networkSources.every(
              (source) => source.endBlock !== undefined,
            )
              ? Math.max(...networkSources.map((source) => source.endBlock!))
              : undefined,
          },
          historical: {
            historicalSync,
            checkpoint: undefined,
            isHistoricalSyncComplete: false,
          },
        } satisfies Service["networkServices"][number];
      }
    }),
  );

  // Register historical sync event listeners
  for (const networkService of networkServices) {
    networkService.historical.historicalSync.on(
      "historicalCheckpoint",
      (checkpoint: Checkpoint) => {
        networkService.historical.checkpoint = checkpoint;

        common.logger.trace({
          service: "sync",
          msg: `New historical checkpoint (timestamp=${checkpoint.blockTimestamp} chainId=${checkpoint.chainId} blockNumber=${checkpoint.blockNumber})`,
        });
      },
    );
    networkService.historical.historicalSync.on("syncComplete", () => {
      networkService.historical.isHistoricalSyncComplete = true;

      if (
        networkServices.every(
          ({ historical }) => historical.isHistoricalSyncComplete,
        )
      ) {
        common.logger.info({
          service: "sync",
          msg: "Completed historical sync across all networks",
        });
      }
    });
  }

  // Invalidate sync cache for devnet sources
  for (const networkService of networkServices) {
    if (networkService.network.disableCache) {
      const minStartBlock = Math.min(
        ...networkService.sources.map((source) => source.startBlock),
      );

      common.logger.warn({
        service: "sync",
        msg: `Deleting cache records for '${networkService.network.name}' from block ${minStartBlock}`,
      });

      await syncStore.pruneByChainId({
        chainId: networkService.network.chainId,
        block: minStartBlock,
      });
    }
  }

  const startCheckpoint = checkpointMin(
    ...networkServices.map((ns) => ns.startCheckpoint),
  );

  const syncService: Service = {
    common,
    syncStore,
    sources,
    networkServices,
    isKilled: false,
    startCheckpoint,
    endCheckpoint: networkServices.every((ns) => ns.endCheckpoint !== undefined)
      ? checkpointMax(...networkServices.map((ns) => ns.endCheckpoint!))
      : undefined,
    // Note: The initial checkpoint will be not zero if there is a cache hit.
    checkpoint: checkpointMax(initialCheckpoint, startCheckpoint),
    finalizedCheckpoint: checkpointMin(
      ...networkServices.map((ns) => ns.initialFinalizedCheckpoint),
    ),
    sourceById,
  };

  return syncService;
};

/**
 * Start the historical sync service for all networks.
 */
export const startHistorical = (syncService: Service) => {
  for (const { historical } of syncService.networkServices) {
    historical.historicalSync.start();
  }
};

/**
 * Returns an async generator of checkpoints that resolves
 * when historical sync is complete.
 */
export const getHistoricalCheckpoint = async function* (
  syncService: Service,
): AsyncGenerator<{ fromCheckpoint: Checkpoint; toCheckpoint: Checkpoint }> {
  while (true) {
    if (syncService.isKilled) return;

    const isComplete = syncService.networkServices.every(
      (ns) => ns.historical.isHistoricalSyncComplete,
    );

    if (isComplete) {
      const finalityCheckpoint = checkpointMin(
        ...syncService.networkServices.map(
          ({ initialFinalizedCheckpoint }) => initialFinalizedCheckpoint,
        ),
      );

      // Do nothing if the checkpoint hasn't advanced. This also protects against
      // edged cases in the caching logic with un-trustworthy finalized checkpoints.
      if (!isCheckpointGreaterThan(finalityCheckpoint, syncService.checkpoint))
        break;

      yield {
        fromCheckpoint: syncService.checkpoint,
        toCheckpoint: syncService.endCheckpoint ?? finalityCheckpoint,
      };

      syncService.checkpoint = finalityCheckpoint;

      break;
    } else {
      await wait(HISTORICAL_CHECKPOINT_INTERVAL);

      const networkCheckpoints = syncService.networkServices.map(
        (ns) => ns.historical.checkpoint,
      );

      // If a network hasn't yet found any checkpoint, it is
      // impossible to determine a checkpoint amongst all networks.
      if (networkCheckpoints.some((nc) => nc === undefined)) {
        continue;
      }

      const newCheckpoint = checkpointMin(
        ...(networkCheckpoints as Checkpoint[]),
      );

      // Do nothing if the checkpoint hasn't advanced.
      if (!isCheckpointGreaterThan(newCheckpoint, syncService.checkpoint)) {
        continue;
      }

      yield {
        fromCheckpoint: syncService.checkpoint,
        toCheckpoint: newCheckpoint,
      };

      syncService.checkpoint = newCheckpoint;
    }
  }
};

/**
 * Start the realtime sync service for all networks.
 */
export const startRealtime = (syncService: Service) => {
  for (const { realtime, network } of syncService.networkServices) {
    if (realtime === undefined) {
      syncService.common.logger.debug({
        service: "realtime",
        msg: `No realtime contracts (network=${network.name})`,
      });
      syncService.common.metrics.ponder_realtime_is_connected.set(
        { network: network.name },
        0,
      );
    } else {
      realtime.realtimeSync.start();
      syncService.common.metrics.ponder_realtime_is_connected.set(
        { network: network.name },
        1,
      );
    }
  }
};

export const kill = async (syncService: Service) => {
  syncService.isKilled = true;

  const killPromise: Promise<void>[] = [];

  for (const { historical, realtime } of syncService.networkServices) {
    historical.historicalSync.kill();
    if (realtime !== undefined) killPromise.push(realtime.realtimeSync.kill());
  }

  await Promise.all(killPromise);
};

/** Return the number and timestamp of the most recently processed blocks. */
export const getStatusBlocks = (
  syncService: Service,
  realtimeCheckpoint?: Checkpoint,
) => {
  const status: {
    [networkName: string]: { number: number; timestamp: number } | undefined;
  } = {};

  for (const networkService of syncService.networkServices) {
    if (networkService.realtime === undefined) {
      status[networkService.network.name] = {
        number: Number(networkService.endCheckpoint!.blockNumber),
        timestamp: networkService.endCheckpoint!.blockTimestamp,
      };
    } else {
      const mostRecentBlock =
        networkService.realtime.realtimeSync.getMostRecentBlock(
          realtimeCheckpoint === undefined
            ? syncService.checkpoint
            : checkpointMin(syncService.checkpoint, realtimeCheckpoint),
        );

      if (mostRecentBlock === undefined) {
        status[networkService.network.name] = undefined;
      } else {
        status[networkService.network.name] = {
          timestamp: mostRecentBlock.timestamp,
          number: mostRecentBlock.number,
        };
      }
    }
  }

  return status;
};

export const getCachedTransport = (syncService: Service, network: Network) => {
  const { requestQueue } = syncService.networkServices.find(
    (ns) => ns.network.chainId === network.chainId,
  )!;
  return cachedTransport({ requestQueue, syncStore: syncService.syncStore });
};

const getLatestAndFinalizedBlocks = async ({
  network,
  requestQueue,
}: { network: Network; requestQueue: RequestQueue }) => {
  const latestBlock = await _eth_getBlockByNumber(
    { requestQueue },
    { blockTag: "latest" },
  );

  const finalizedBlockNumber = Math.max(
    0,
    hexToNumber(latestBlock.number) - network.finalityBlockCount,
  );

  const finalizedBlock = await _eth_getBlockByNumber(
    { requestQueue },
    {
      blockNumber: finalizedBlockNumber,
    },
  );

  return { latestBlock, finalizedBlock };
};

const getCanSkipRealtime = ({
  sources,
  finalizedBlock,
}: {
  sources: EventSource[];
  finalizedBlock: SyncBlock;
}) => {
  // If an endBlock is specified for every event source on this network, and the
  // latest end block is less than the finalized block number, we can stop here.
  // The service won't poll for new blocks and won't emit any events.
  const endBlocks = sources.map((f) => f.endBlock);
  return endBlocks.every(
    (b) => b !== undefined && b <= hexToNumber(finalizedBlock.number),
  );
};
