import type { Common } from "@/internal/common.js";
import type { Factory, Network, Source, Status } from "@/internal/types.js";
import { createHistoricalSync } from "@/sync-historical/index.js";
import { createRealtimeSync } from "@/sync-realtime/index.js";
import type { RealtimeSyncEvent } from "@/sync-realtime/index.js";
import type { SyncStore } from "@/sync-store/index.js";
import {
  ZERO_CHECKPOINT_STRING,
  decodeCheckpoint,
  min,
} from "@/utils/checkpoint.js";
import { bufferAsyncGenerator } from "@/utils/generators.js";
import { never } from "@/utils/never.js";
import type { RequestQueue } from "@/utils/requestQueue.js";
import { type Address, hexToNumber } from "viem";
import { buildEvents } from "./events.js";
import { isAddressFactory } from "./filter.js";
import {
  type RealtimeEvent,
  type Seconds,
  type Sync,
  getChainCheckpoint,
  getLocalEventGenerator,
  getLocalSyncGenerator,
  getLocalSyncProgress,
  getRealtimeSyncEventHandler,
  isSyncEnd,
} from "./index.js";

export const createSyncMultichain = async (params: {
  common: Common;
  network: Network;
  requestQueue: RequestQueue;
  sources: Source[];
  syncStore: SyncStore;
  onRealtimeEvent(event: RealtimeEvent): Promise<void>;
  onFatalError(error: Error): void;
  initialCheckpoint: string;
}): Promise<Sync> => {
  // Invalidate sync cache for devnet sources
  if (params.network.disableCache) {
    params.common.logger.warn({
      service: "sync",
      msg: `Deleting cache records for '${params.network.name}'`,
    });

    await params.syncStore.pruneByChain({
      chainId: params.network.chainId,
    });
  }

  const historicalSync = await createHistoricalSync({
    common: params.common,
    network: params.network,
    sources: params.sources,
    syncStore: params.syncStore,
    requestQueue: params.requestQueue,
    onFatalError: params.onFatalError,
  });

  const syncProgress = await getLocalSyncProgress({
    common: params.common,
    network: params.network,
    sources: params.sources,
    requestQueue: params.requestQueue,
    intervalsCache: historicalSync.intervalsCache,
  });

  const realtimeSync = createRealtimeSync({
    common: params.common,
    network: params.network,
    sources: params.sources,
    requestQueue: params.requestQueue,
    onEvent: (event) =>
      onRealtimeSyncEventBase(event)
        .then((event) => onRealtimeSyncEventMultichain(event))
        .catch((error) => {
          params.common.logger.error({
            service: "sync",
            msg: `Fatal error: Unable to process ${event.type} event`,
            error,
          });
          params.onFatalError(error);
        }),
    onFatalError: params.onFatalError,
  });

  params.common.metrics.ponder_sync_is_realtime.set(
    { network: params.network.name },
    0,
  );
  params.common.metrics.ponder_sync_is_complete.set(
    { network: params.network.name },
    0,
  );

  const getMultichainCheckpoint = (
    tag: "start" | "end" | "current" | "finalized",
  ): string | undefined => {
    return getChainCheckpoint({ syncProgress, network: params.network, tag });
  };

  const status: Status = {
    [params.network.name]: { block: null, ready: false },
  };

  const seconds: Seconds = {
    start: decodeCheckpoint(getMultichainCheckpoint("start")!).blockTimestamp,
    end: decodeCheckpoint(
      min(getMultichainCheckpoint("end"), getMultichainCheckpoint("finalized")),
    ).blockTimestamp,
  };

  let isKilled = false;

  async function* getEvents() {
    const to = min(
      getMultichainCheckpoint("end"),
      getMultichainCheckpoint("finalized"),
    );

    const localSyncGenerator = getLocalSyncGenerator({
      common: params.common,
      network: params.network,
      syncProgress,
      historicalSync,
    });

    const localEventGenerator = getLocalEventGenerator({
      syncStore: params.syncStore,
      sources: params.sources,
      localSyncGenerator,
      from:
        params.initialCheckpoint !== ZERO_CHECKPOINT_STRING
          ? params.initialCheckpoint
          : getMultichainCheckpoint("start")!,
      to,
      limit: 1000,
    });

    const eventGenerator = bufferAsyncGenerator(localEventGenerator, 2);

    for await (const { events, checkpoint } of eventGenerator) {
      status[params.network.name]!.block = {
        timestamp: decodeCheckpoint(checkpoint).blockTimestamp,
        number: Number(decodeCheckpoint(checkpoint).blockNumber),
      };

      yield events;
    }
  }

  const onRealtimeSyncEventBase = getRealtimeSyncEventHandler({
    common: params.common,
    network: params.network,
    sources: params.sources,
    syncStore: params.syncStore,
    syncProgress,
    realtimeSync,
  });

  const onRealtimeSyncEventMultichain = (event: RealtimeSyncEvent): void => {
    switch (event.type) {
      case "block": {
        const checkpoint = getMultichainCheckpoint("current")!;

        const events = buildEvents({
          sources: params.sources,
          chainId: params.network.chainId,
          blockWithEventData: event,
          finalizedChildAddresses: realtimeSync.finalizedChildAddresses,
          unfinalizedChildAddresses: realtimeSync.unfinalizedChildAddresses,
        });

        status[params.network.name]!.block = {
          timestamp: hexToNumber(event.block.timestamp),
          number: hexToNumber(event.block.number),
        };

        seconds.end = hexToNumber(event.block.timestamp);

        params
          .onRealtimeEvent({
            type: "block",
            checkpoint,
            status: structuredClone(status),
            events,
            network: params.network,
          })
          .then(() => {
            if (events.length > 0 && isKilled === false) {
              params.common.logger.info({
                service: "app",
                msg: `Indexed ${events.length} events`,
              });
            }

            // update `ponder_realtime_latency` metric
            if (event.endClock) {
              params.common.metrics.ponder_realtime_latency.observe(
                { network: params.network.name },
                event.endClock(),
              );
            }
          });

        break;
      }

      case "finalize": {
        const checkpoint = getMultichainCheckpoint("finalized")!;
        params.onRealtimeEvent({
          type: "finalize",
          checkpoint,
          network: params.network,
        });
        break;
      }

      case "reorg": {
        // Note: this checkpoint is <= the previous checkpoint
        const checkpoint = getMultichainCheckpoint("current")!;
        params.onRealtimeEvent({
          type: "reorg",
          checkpoint,
          network: params.network,
        });
        break;
      }

      default:
        never(event);
    }
  };

  return {
    getEvents,
    async startRealtime() {
      status[params.network.name]!.block = {
        number: hexToNumber(syncProgress.current!.number),
        timestamp: hexToNumber(syncProgress.current!.timestamp),
      };
      status[params.network.name]!.ready = true;

      if (isSyncEnd(syncProgress)) {
        params.common.metrics.ponder_sync_is_complete.set(
          { network: params.network.name },
          1,
        );
      } else {
        params.common.metrics.ponder_sync_is_realtime.set(
          { network: params.network.name },
          1,
        );

        const initialChildAddresses = new Map<Factory, Set<Address>>();

        for (const { filter } of params.sources) {
          switch (filter.type) {
            case "log":
              if (isAddressFactory(filter.address)) {
                const addresses = await params.syncStore.getChildAddresses({
                  filter: filter.address,
                });

                initialChildAddresses.set(filter.address, new Set(addresses));
              }
              break;

            case "transaction":
            case "transfer":
            case "trace":
              if (isAddressFactory(filter.fromAddress)) {
                const addresses = await params.syncStore.getChildAddresses({
                  filter: filter.fromAddress,
                });

                initialChildAddresses.set(
                  filter.fromAddress,
                  new Set(addresses),
                );
              }

              if (isAddressFactory(filter.toAddress)) {
                const addresses = await params.syncStore.getChildAddresses({
                  filter: filter.toAddress,
                });

                initialChildAddresses.set(filter.toAddress, new Set(addresses));
              }

              break;
          }
        }

        realtimeSync.start({ syncProgress, initialChildAddresses });
      }
    },
    getStatus() {
      return status;
    },
    getSeconds() {
      return seconds;
    },
    getFinalizedCheckpoint() {
      return getMultichainCheckpoint("finalized")!;
    },
    async kill() {
      isKilled = true;
      historicalSync.kill();
      await realtimeSync.kill();
    },
  };
};
