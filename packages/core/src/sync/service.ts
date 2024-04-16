import type { RealtimeEvent } from "@/bin/utils/run.js";
import type { Common } from "@/common/common.js";
import type { Network } from "@/config/networks.js";
import type { EventSource } from "@/config/sources.js";
import { HistoricalSyncService } from "@/sync-historical/service.js";
import {
  type RealtimeSyncEvent,
  type RealtimeSyncService,
  createRealtimeSyncService,
  startRealtimeSyncService,
} from "@/sync-realtime/service.js";
import type { SyncStore } from "@/sync-store/store.js";
import { type Event, decodeEvents } from "@/sync/events.js";
import {
  type Checkpoint,
  checkpointMin,
  isCheckpointGreaterThan,
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
  checkpoint: Checkpoint | undefined;

  // network specific services
  networkServices: {
    network: Network;
    sources: EventSource[];
    requestQueue: RequestQueue;
    cachedTransport: Transport;

    historicalSync: HistoricalSyncService;
    realtimeSync: RealtimeSyncService;

    checkpoint: Checkpoint | undefined;
    isHistoricalSyncComplete: boolean;
    finalizedBlock: SyncBlock;
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
        // set checkpoint
        syncService.networkServices.find(
          (ns) => ns.network.chainId === realtimeSyncEvent.chainId,
        )!.checkpoint = realtimeSyncEvent.checkpoint;

        const networkCheckpoints = syncService.networkServices.map(
          (ns) => ns.checkpoint,
        );

        // ...
        if (networkCheckpoints.some((nc) => nc === undefined)) break;

        const newCheckpoint = checkpointMin(
          ...(networkCheckpoints as Checkpoint[]),
        );

        for await (const rawEvents of syncStore.getLogEvents({
          sources,
          fromCheckpoint: syncService.checkpoint ?? zeroCheckpoint,
          toCheckpoint: newCheckpoint,
          limit: 1_000,
        })) {
          const events = decodeEvents({ common, sourceById }, rawEvents);
          // TODO(kyle) manage concurrency
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
        )!.checkpoint = realtimeSyncEvent.safeCheckpoint;

        if (
          syncService.checkpoint !== undefined &&
          isCheckpointGreaterThan(
            realtimeSyncEvent.safeCheckpoint,
            syncService.checkpoint,
          )
        ) {
          syncService.checkpoint = realtimeSyncEvent.safeCheckpoint;
        }

        onRealtimeEvent(realtimeSyncEvent);
      }
      // TODO(kyle) set network specific checkpoint backwards
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
        historicalSync,
        realtimeSync,
        checkpoint: undefined,
        isHistoricalSyncComplete: false,
        finalizedBlock,
      } satisfies SyncService["networkServices"][number];
    }),
  );

  // Register historical sync event listeners
  for (const networkService of networkServices) {
    networkService.historicalSync.on(
      "historicalCheckpoint",
      (checkpoint: Checkpoint) => {
        networkService.checkpoint = checkpoint;

        common.logger.trace({
          service: "sync",
          msg: `New historical checkpoint (timestamp=${checkpoint.blockTimestamp} chainId=${checkpoint.chainId} blockNumber=${checkpoint.blockNumber})`,
        });
      },
    );
    networkService.historicalSync.on("syncComplete", () => {
      networkService.isHistoricalSyncComplete = true;

      if (networkServices.every((ns) => ns.isHistoricalSyncComplete)) {
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
    checkpoint: undefined,
    sourceById,
  };

  return syncService;
};

/**
 * Start the historical sync service for all networks.
 */
export const startHistoricalSyncServices = (syncService: SyncService) => {
  for (const { historicalSync } of syncService.networkServices) {
    historicalSync.start();
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
    await wait(HISTORICAL_CHECKPOINT_INTERVAL);

    const networkCheckpoints = syncService.networkServices.map(
      (ns) => ns.checkpoint,
    );

    // ...
    if (networkCheckpoints.some((nc) => nc === undefined)) {
      yield [];
      continue;
    }

    const newCheckpoint = checkpointMin(
      ...(networkCheckpoints as Checkpoint[]),
    );

    for await (const rawEvents of syncService.syncStore.getLogEvents({
      sources: syncService.sources,
      // Note: would be nice to change the query such that this
      // isn't required
      fromCheckpoint: syncService.checkpoint ?? zeroCheckpoint,
      toCheckpoint: newCheckpoint,
      limit: 1_000,
    })) {
      yield decodeEvents(syncService, rawEvents);
    }

    syncService.checkpoint = newCheckpoint;

    if (
      syncService.networkServices.every((ns) => ns.isHistoricalSyncComplete)
    ) {
      break;
    }
  }
};

/**
 * Start the realtime sync service for all networks.
 */
export const startRealtimeSyncServices = (syncService: SyncService) => {
  for (const {
    realtimeSync,
    network,
    sources,
    finalizedBlock,
  } of syncService.networkServices) {
    // If an endBlock is specified for every event source on this network, and the
    // latest end block is less than the finalized block number, we can stop here.
    // The service won't poll for new blocks and won't emit any events.
    // TODO(kyle) should it be <= instead
    const endBlocks = sources.map((f) => f.endBlock);
    if (
      endBlocks.every(
        (b) => b !== undefined && b < hexToNumber(finalizedBlock.number),
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
      startRealtimeSyncService(realtimeSync);
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
