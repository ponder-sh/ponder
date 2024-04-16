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
import { type Transport, hexToNumber } from "viem";
import { type SyncBlock, _eth_getBlockByNumber } from "./index.js";
import { cachedTransport } from "./transport.js";

export type SyncService = {
  // static
  common: Common;
  syncStore: SyncStore;
  sources: EventSource[];

  // state
  checkpoint: Checkpoint;

  // network specific services
  networkServices: {
    network: Network;
    sources: EventSource[];
    requestQueue: RequestQueue;
    cachedTransport: Transport;

    realtime: {
      realtimeSync: RealtimeSyncService;
      checkpoint: Checkpoint;
      finalizedBlock: SyncBlock;
    };

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

export const createSyncService = async ({
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
}): Promise<SyncService> => {
  const sourceById = sources.reduce<SyncService["sourceById"]>((acc, cur) => {
    acc[cur.id] = cur;
    return acc;
  }, {});

  const onRealtimeSyncEvent = async (realtimeSyncEvent: RealtimeSyncEvent) => {
    switch (realtimeSyncEvent.type) {
      case "checkpoint": {
        syncService.networkServices.find(
          (ns) => ns.network.chainId === realtimeSyncEvent.chainId,
        )!.realtime.checkpoint = realtimeSyncEvent.checkpoint;

        const newCheckpoint = checkpointMin(
          ...syncService.networkServices.map((ns) => ns.realtime.checkpoint),
        );

        if (isCheckpointEqual(newCheckpoint, syncService.checkpoint)) return;

        for await (const rawEvents of syncStore.getLogEvents({
          sources,
          fromCheckpoint: syncService.checkpoint,
          toCheckpoint: newCheckpoint,
          limit: 1_000,
        })) {
          const events = decodeEvents({ common, sourceById }, rawEvents);
          await onRealtimeEvent({
            type: "newEvents",
            events: events,
          });
        }

        syncService.checkpoint = newCheckpoint;
      }
      break;

      case "reorg": {
        syncService.networkServices.find(
          (ns) => ns.network.chainId === realtimeSyncEvent.chainId,
        )!.realtime.checkpoint = realtimeSyncEvent.safeCheckpoint;

        if (
          isCheckpointGreaterThan(
            realtimeSyncEvent.safeCheckpoint,
            syncService.checkpoint,
          )
        ) {
          syncService.checkpoint = realtimeSyncEvent.safeCheckpoint;
        }

        onRealtimeEvent(realtimeSyncEvent);
      }
      break;

      default:
        never(realtimeSyncEvent);
    }
  };

  const networkServices: SyncService["networkServices"] = await Promise.all(
    networks.map(async (network) => {
      const networkSources = sources.filter(
        (source) => source.networkName === network.name,
      );

      const requestQueue = createRequestQueue({
        network,
        metrics: common.metrics,
      });

      const { latestBlock, finalizedBlock } = await setupSyncForNetwork({
        network,
        requestQueue,
      });

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
        realtime: {
          realtimeSync,
          checkpoint: {
            ...maxCheckpoint,
            blockTimestamp: hexToNumber(finalizedBlock.timestamp),
            chainId: network.chainId,
            blockNumber: hexToNumber(finalizedBlock.number),
          },
          finalizedBlock,
        },
        historical: {
          historicalSync,
          checkpoint: undefined,
          isHistoricalSyncComplete: false,
        },
      } satisfies SyncService["networkServices"][number];
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

  const syncService: SyncService = {
    common,
    syncStore,
    sources,
    networkServices,
    checkpoint: zeroCheckpoint,
    sourceById,
  };

  return syncService;
};

/**
 * Start the historical sync service for all networks.
 */
export const startHistoricalSyncServices = (syncService: SyncService) => {
  for (const { historical } of syncService.networkServices) {
    historical.historicalSync.start();
  }
};

/**
 * Returns an async generator of events that resolves
 * when historical sync is complete.
 */
export const getHistoricalEvents = async function* (
  syncService: SyncService,
): AsyncGenerator<Event[]> {
  while (true) {
    const isComplete = syncService.networkServices.every(
      (ns) => ns.historical.isHistoricalSyncComplete,
    );

    if (isComplete) {
      const finalityCheckpoint = checkpointMin(
        ...syncService.networkServices.map(({ realtime, network }) => ({
          ...maxCheckpoint,
          blockTimestamp: hexToNumber(realtime.finalizedBlock.timestamp),
          chainId: network.chainId,
          blockNumber: hexToNumber(realtime.finalizedBlock.number),
        })),
      );

      for await (const rawEvents of syncService.syncStore.getLogEvents({
        sources: syncService.sources,
        fromCheckpoint: syncService.checkpoint,
        toCheckpoint: finalityCheckpoint,
        limit: 1_000,
      })) {
        yield decodeEvents(syncService, rawEvents);
      }

      syncService.checkpoint = finalityCheckpoint;

      break;
    } else {
      await wait(HISTORICAL_CHECKPOINT_INTERVAL);

      const networkCheckpoints = syncService.networkServices.map(
        (ns) => ns.historical.checkpoint,
      );

      // ...
      if (networkCheckpoints.some((nc) => nc === undefined)) {
        continue;
      }

      const newCheckpoint = checkpointMin(
        ...(networkCheckpoints as Checkpoint[]),
      );

      if (isCheckpointEqual(newCheckpoint, syncService.checkpoint)) {
        continue;
      }

      for await (const rawEvents of syncService.syncStore.getLogEvents({
        sources: syncService.sources,
        fromCheckpoint: syncService.checkpoint,
        toCheckpoint: newCheckpoint,
        limit: 1_000,
      })) {
        yield decodeEvents(syncService, rawEvents);
      }

      syncService.checkpoint = newCheckpoint;
    }
  }
};

/**
 * Start the realtime sync service for all networks.
 */
export const startRealtimeSyncServices = (syncService: SyncService) => {
  for (const { realtime, network, sources } of syncService.networkServices) {
    // If an endBlock is specified for every event source on this network, and the
    // latest end block is less than the finalized block number, we can stop here.
    // The service won't poll for new blocks and won't emit any events.
    // TODO(kyle) should it be <= instead
    const endBlocks = sources.map((f) => f.endBlock);
    if (
      endBlocks.every(
        (b) =>
          b !== undefined && b < hexToNumber(realtime.finalizedBlock.number),
      )
    ) {
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

export const killSyncService = (_syncService: SyncService) => {
  // TODO(kyle)
};

export const getCachedTransport = (
  syncService: SyncService,
  network: Network,
) => {
  const { requestQueue } = syncService.networkServices.find(
    (ns) => ns.network.chainId === network.chainId,
  )!;
  return cachedTransport({ requestQueue, syncStore: syncService.syncStore });
};

/**
 * ...
 */
const setupSyncForNetwork = async ({
  network,
  requestQueue,
}: { network: Network; requestQueue: RequestQueue }) => {
  const latestBlock = await _eth_getBlockByNumber(
    { requestQueue },
    { blockTag: "latest" },
  );

  // TODO(kyle) validate that the remote chainId
  // matched the user provided chainId
  await requestQueue.request({ method: "eth_chainId" }).then(hexToNumber);

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
