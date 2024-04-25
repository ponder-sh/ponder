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
import { type Event, decodeEvents } from "@/sync/events.js";
import {
  type Checkpoint,
  checkpointMin,
  isCheckpointEqual,
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
  isKilled: boolean;

  // network specific services
  networkServices: {
    network: Network;
    sources: EventSource[];
    requestQueue: RequestQueue;
    cachedTransport: Transport;

    initialFinalizedCheckpoint: Checkpoint;

    realtime:
      | {
          realtimeSync: RealtimeSyncService;
          checkpoint: Checkpoint;
          finalizedBlock: SyncBlock;
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
}: {
  common: Common;
  syncStore: SyncStore;
  networks: Network[];
  sources: EventSource[];
  onRealtimeEvent: (realtimeEvent: RealtimeEvent) => Promise<void>;
  onFatalError: (error: Error) => void;
}): Promise<Service> => {
  const sourceById = sources.reduce<Service["sourceById"]>((acc, cur) => {
    acc[cur.id] = cur;
    return acc;
  }, {});

  const onRealtimeSyncEvent = (realtimeSyncEvent: RealtimeSyncEvent) => {
    switch (realtimeSyncEvent.type) {
      case "checkpoint": {
        if (syncService.isKilled) return;

        syncService.networkServices.find(
          (ns) => ns.network.chainId === realtimeSyncEvent.chainId,
        )!.realtime!.checkpoint = realtimeSyncEvent.checkpoint;

        // `realtime` can be undefined if no contracts for that network require a realtime
        // service. Those networks can be left out of the checkpoint calculation.
        const newCheckpoint = checkpointMin(
          ...syncService.networkServices
            .filter((ns) => ns.realtime !== undefined)
            .map((ns) => ns.realtime!.checkpoint),
        );

        if (isCheckpointEqual(newCheckpoint, syncService.checkpoint)) return;

        // Pass decoded events while respecting pagination. Must be cautious to deep copy
        // checkpoints.

        const fromCheckpoint = { ...syncService.checkpoint };
        const toCheckpoint = { ...newCheckpoint };

        syncService.checkpoint = newCheckpoint;

        (async () => {
          const lastEventCheckpoint =
            await syncService.syncStore.getLastEventCheckpoint({
              sources: syncService.sources,
              fromCheckpoint,
              toCheckpoint,
            });

          for await (const rawEvents of syncStore.getLogEvents({
            sources,
            fromCheckpoint,
            toCheckpoint,
            limit: 1_000,
          })) {
            await onRealtimeEvent({
              type: "newEvents",
              events: decodeEvents({ common, sourceById }, rawEvents),
              lastEventCheckpoint: lastEventCheckpoint,
            });
          }
        })();

        break;
      }

      case "reorg": {
        if (syncService.isKilled) return;

        syncService.networkServices.find(
          (ns) => ns.network.chainId === realtimeSyncEvent.chainId,
        )!.realtime!.checkpoint = realtimeSyncEvent.safeCheckpoint;

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

      const [{ latestBlock, finalizedBlock }, remoteChainId] =
        await Promise.all([
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

      const historicalSync = new HistoricalSyncService({
        common,
        syncStore,
        network,
        requestQueue,
        sources: networkSources,
      });

      await historicalSync.setup({
        latestBlockNumber: hexToNumber(latestBlock.number),
        finalizedBlockNumber: hexToNumber(finalizedBlock.number),
      });

      const initialFinalizedCheckpoint: Checkpoint = {
        ...maxCheckpoint,
        blockTimestamp: hexToNumber(finalizedBlock.timestamp),
        chainId: BigInt(network.chainId),
        blockNumber: hexToBigInt(finalizedBlock.number),
      };

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
          initialFinalizedCheckpoint,
          realtime: {
            realtimeSync,
            checkpoint: initialFinalizedCheckpoint,
            finalizedBlock,
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

  const syncService: Service = {
    common,
    syncStore,
    sources,
    networkServices,
    isKilled: false,
    checkpoint: zeroCheckpoint,
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
 * Returns an async generator of events that resolves
 * when historical sync is complete.
 */
export const getHistoricalEvents = async function* (
  syncService: Service,
): AsyncGenerator<{
  events: Event[];
  lastEventCheckpoint: Checkpoint | undefined;
}> {
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

      const lastEventCheckpoint =
        await syncService.syncStore.getLastEventCheckpoint({
          sources: syncService.sources,
          fromCheckpoint: syncService.checkpoint,
          toCheckpoint: finalityCheckpoint,
        });

      for await (const rawEvents of syncService.syncStore.getLogEvents({
        sources: syncService.sources,
        fromCheckpoint: syncService.checkpoint,
        toCheckpoint: finalityCheckpoint,
        limit: 1_000,
      })) {
        yield {
          events: decodeEvents(syncService, rawEvents),
          lastEventCheckpoint: lastEventCheckpoint,
        };
      }

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

      if (isCheckpointEqual(newCheckpoint, syncService.checkpoint)) {
        continue;
      }

      const lastEventCheckpoint =
        await syncService.syncStore.getLastEventCheckpoint({
          sources: syncService.sources,
          fromCheckpoint: syncService.checkpoint,
          toCheckpoint: newCheckpoint,
        });

      for await (const rawEvents of syncService.syncStore.getLogEvents({
        sources: syncService.sources,
        fromCheckpoint: syncService.checkpoint,
        toCheckpoint: newCheckpoint,
        limit: 1_000,
      })) {
        yield {
          events: decodeEvents(syncService, rawEvents),
          lastEventCheckpoint: lastEventCheckpoint,
        };
      }

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
