import type { Common } from "@/internal/common.js";
import type { Factory, Network, Source, Status } from "@/internal/types.js";
import { createHistoricalSync } from "@/sync-historical/index.js";
import { createRealtimeSync } from "@/sync-realtime/index.js";
import type { RealtimeSyncEvent } from "@/sync-realtime/index.js";
import type { SyncStore } from "@/sync-store/index.js";
import {
  decodeCheckpoint,
  encodeCheckpoint,
  min,
  zeroCheckpoint,
} from "@/utils/checkpoint.js";
import { bufferAsyncGenerator } from "@/utils/generators.js";
import type { Interval } from "@/utils/interval.js";
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
  // const filters = params.sources.map(({ filter }) => filter);

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
      onRealtimeSyncEvent(event).catch((error) => {
        params.common.logger.error({
          service: "sync",
          msg: `Fatal error: Unable to process ${event.type} event`,
          error,
        });
        params.onFatalError(error);
      }),
    onFatalError: params.onFatalError,
  });

  let unfinalizedBlocks: Omit<
    Extract<RealtimeSyncEvent, { type: "block" }>,
    "type"
  >[] = [];

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
    [params.network.chainId]: { block: null, ready: false },
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
        params.initialCheckpoint !== encodeCheckpoint(zeroCheckpoint)
          ? params.initialCheckpoint
          : getMultichainCheckpoint("start")!,
      to,
      limit: 1000,
    });

    const eventGenerator = bufferAsyncGenerator(localEventGenerator, 2);

    for await (const { events, checkpoint } of eventGenerator) {
      status[params.network.chainId]!.block = {
        timestamp: decodeCheckpoint(checkpoint).blockTimestamp,
        number: Number(decodeCheckpoint(checkpoint).blockNumber),
      };

      yield events;
    }
  }

  const onRealtimeSyncEvent = async (event: RealtimeSyncEvent) => {
    switch (event.type) {
      case "block": {
        syncProgress.current = event.block;
        const checkpoint = getMultichainCheckpoint("current")!;

        params.common.metrics.ponder_sync_block.set(
          { network: params.network.name },
          hexToNumber(syncProgress.current.number),
        );

        const events = buildEvents({
          sources: params.sources,
          chainId: params.network.chainId,
          blockWithEventData: event,
          finalizedChildAddresses: realtimeSync.finalizedChildAddresses,
          unfinalizedChildAddresses: realtimeSync.unfinalizedChildAddresses,
        });

        status[params.network.chainId]!.block = {
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
        // Newly finalized range
        const interval = [
          hexToNumber(syncProgress.finalized.number),
          hexToNumber(event.block.number),
        ] satisfies Interval;

        syncProgress.finalized = event.block;
        const checkpoint = getMultichainCheckpoint("finalized")!;

        params.onRealtimeEvent({ type: "finalize", checkpoint });

        // Remove all finalized data

        const finalizedBlocks = unfinalizedBlocks.filter(
          ({ block }) =>
            hexToNumber(block.number) <= hexToNumber(event.block.number),
        );

        unfinalizedBlocks = unfinalizedBlocks.filter(
          ({ block }) =>
            hexToNumber(block.number) > hexToNumber(event.block.number),
        );

        // Add finalized blocks, logs, transactions, receipts, and traces to the sync-store.

        await Promise.all([
          params.syncStore.insertBlocks({
            blocks: finalizedBlocks
              .filter(({ hasMatchedFilter }) => hasMatchedFilter)
              .map(({ block }) => block),
            chainId: params.network.chainId,
          }),
          params.syncStore.insertLogs({
            logs: finalizedBlocks.flatMap(({ logs, block }) =>
              logs.map((log) => ({ log, block })),
            ),
            shouldUpdateCheckpoint: true,
            chainId: params.network.chainId,
          }),
          params.syncStore.insertLogs({
            logs: finalizedBlocks.flatMap(({ factoryLogs }) =>
              factoryLogs.map((log) => ({ log })),
            ),
            shouldUpdateCheckpoint: false,
            chainId: params.network.chainId,
          }),
          params.syncStore.insertTransactions({
            transactions: finalizedBlocks.flatMap(({ transactions, block }) =>
              transactions.map((transaction) => ({
                transaction,
                block,
              })),
            ),
            chainId: params.network.chainId,
          }),
          params.syncStore.insertTransactionReceipts({
            transactionReceipts: finalizedBlocks.flatMap(
              ({ transactionReceipts }) => transactionReceipts,
            ),
            chainId: params.network.chainId,
          }),
          params.syncStore.insertTraces({
            traces: finalizedBlocks.flatMap(({ traces, block, transactions }) =>
              traces.map((trace) => ({
                trace,
                block,
                transaction: transactions.find(
                  (t) => t.hash === trace.transactionHash,
                )!,
              })),
            ),
            chainId: params.network.chainId,
          }),
        ]);

        // Add corresponding intervals to the sync-store
        // Note: this should happen after insertion so the database doesn't become corrupted

        if (params.network.disableCache === false) {
          await params.syncStore.insertIntervals({
            intervals: params.sources.map(({ filter }) => ({
              filter,
              interval,
            })),
            chainId: params.network.chainId,
          });
        }

        // The realtime service can be killed if `endBlock` is
        // defined has become finalized.
        if (isSyncEnd(syncProgress)) {
          params.common.metrics.ponder_sync_is_realtime.set(
            { network: params.network.name },
            0,
          );
          params.common.metrics.ponder_sync_is_complete.set(
            { network: params.network.name },
            1,
          );
          params.common.logger.info({
            service: "sync",
            msg: `Synced final end block for '${params.network.name}' (${hexToNumber(syncProgress.end!.number)}), killing realtime sync service`,
          });
          realtimeSync.kill();
        }
        break;
      }

      case "reorg": {
        syncProgress.current = event.block;
        // Note: this checkpoint is <= the previous checkpoint
        const checkpoint = getMultichainCheckpoint("current")!;

        params.common.metrics.ponder_sync_block.set(
          { network: params.network.name },
          hexToNumber(syncProgress.current.number),
        );

        // Remove all reorged data

        unfinalizedBlocks = unfinalizedBlocks.filter(
          ({ block }) =>
            hexToNumber(block.number) <= hexToNumber(event.block.number),
        );

        await params.syncStore.pruneRpcRequestResult({
          chainId: params.network.chainId,
          blocks: event.reorgedBlocks,
        });

        params.onRealtimeEvent({ type: "reorg", checkpoint });

        break;
      }

      default:
        never(event);
    }
  };

  return {
    getEvents,
    async startRealtime() {
      status[params.network.chainId]!.block = {
        number: hexToNumber(syncProgress.current!.number),
        timestamp: hexToNumber(syncProgress.current!.timestamp),
      };
      status[params.network.chainId]!.ready = true;

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
          // TODO(kyle) this is a bug for accounts sources
          if ("address" in filter && isAddressFactory(filter.address)) {
            const addresses = await params.syncStore.getChildAddresses({
              filter: filter.address,
            });

            initialChildAddresses.set(filter.address, new Set(addresses));
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
