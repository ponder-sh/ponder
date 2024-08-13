import type { Common } from "@/common/common.js";
import type { Network } from "@/config/networks.js";
import {
  type RealtimeSync,
  type RealtimeSyncEvent,
  createRealtimeSync,
} from "@/sync-realtime/index.js";
import type { SyncStore } from "@/sync-store/index.js";
import type { LightBlock, SyncBlock } from "@/types/sync.js";
import {
  type Checkpoint,
  checkpointMin,
  decodeCheckpoint,
  encodeCheckpoint,
  maxCheckpoint,
  zeroCheckpoint,
} from "@/utils/checkpoint.js";
import type { Interval } from "@/utils/interval.js";
import { never } from "@/utils/never.js";
import { createQueue } from "@ponder/common";
import { type Transport, hexToBigInt, hexToNumber } from "viem";
import { _eth_getBlockByNumber } from "../utils/rpc.js";
import type { RawEvent } from "./events.js";
import { type LocalSync, createLocalSync } from "./local.js";
import type { Source } from "./source.js";
import { cachedTransport } from "./transport.js";

export type Sync = {
  getEvents(): AsyncGenerator<{ events: RawEvent[]; checkpoint: string }>;
  startRealtime(): void;
  getStatus(): Status;
  /** Return the minimum start checkpoint (supremum) for all networks. */
  getStartCheckpoint(): string;
  /** Return the minimum finalized checkpoint (supremum) for all networks. */
  getFinalizedCheckpoint(): string;
  getCachedTransport(network: Network): Transport;
  kill(): Promise<void>;
};

export type RealtimeEvent =
  | {
      type: "block";
      checkpoint: string;
      events: RawEvent[];
    }
  | {
      type: "reorg";
      checkpoint: string;
    }
  | {
      type: "finalize";
      checkpoint: string;
    };

export type Status = {
  [networkName: string]: {
    block: { number: number; timestamp: number } | null;
    ready: boolean;
  };
};

export const syncBlockToLightBlock = ({
  hash,
  parentHash,
  number,
  timestamp,
}: SyncBlock): LightBlock => ({ hash, parentHash, number, timestamp });

type CreateSyncParameters = {
  common: Common;
  syncStore: SyncStore;
  sources: Source[];
  networks: Network[];
  onRealtimeEvent(event: RealtimeEvent): void;
  onFatalError(error: Error): void;
  initialCheckpoint: Checkpoint;
};

export const createSync = async (args: CreateSyncParameters): Promise<Sync> => {
  // Network-specific syncs and status
  const localSyncs = new Map<Network, LocalSync>();
  const realtimeSyncs = new Map<Network, RealtimeSync>();
  const status: Status = {};
  let isKilled = false;

  // Create a `LocalSync` for each network, populating `localSyncs`.
  await Promise.all(
    args.networks.map(async (network) => {
      const localSync = await createLocalSync({
        common: args.common,
        syncStore: args.syncStore,
        sources: args.sources.filter(
          ({ filter }) => filter.chainId === network.chainId,
        ),
        network,
      });
      localSyncs.set(network, localSync);
      status[network.name] = { block: null, ready: false };
    }),
  );

  // Invalidate sync cache for devnet sources
  for (const network of args.networks) {
    if (network.disableCache) {
      const startBlock = hexToNumber(
        localSyncs.get(network)!.startBlock.number,
      );

      args.common.logger.warn({
        service: "sync",
        msg: `Deleting cache records for '${network.name}' from block ${startBlock}`,
      });

      await args.syncStore.pruneByChain({
        fromBlock: startBlock,
        chainId: network.chainId,
      });
    }
  }

  /** Convert `block` to a `Checkpoint`. */
  const blockToCheckpoint = (
    block: LightBlock | SyncBlock,
    chainId: number,
    rounding: "up" | "down",
  ): Checkpoint => {
    return {
      ...(rounding === "up" ? maxCheckpoint : zeroCheckpoint),
      blockTimestamp: hexToNumber(block.timestamp),
      chainId: BigInt(chainId),
      blockNumber: hexToBigInt(block.number),
    };
  };

  /**
   * Returns the minimum checkpoint across all chains.
   *
   * Note: `localSync.latestBlock` is assumed to be defined if
   * this function is called with `tag`: "latest".
   */
  const getChainsCheckpoint = (
    tag: "start" | "latest" | "finalized" | "end",
  ): string | undefined => {
    if (
      tag === "end" &&
      [...localSyncs.values()].some(
        (localSync) => localSync.endBlock === undefined,
      )
    ) {
      return undefined;
    }

    let checkpoints = [...localSyncs.entries()];
    if (tag === "latest")
      checkpoints = checkpoints.filter(
        ([, localSync]) => localSync.isComplete() === false,
      );
    // Return early if all networks are complete
    if (checkpoints.length === 0) return undefined;

    return encodeCheckpoint(
      checkpointMin(
        ...checkpoints.map(([network, localSync]) => {
          const block = localSync[`${tag}Block`]!;

          // The checkpoint returned by this function is meant to be used in
          // a closed interval (includes endpoints), so "start" should be inclusive.
          return blockToCheckpoint(
            block,
            network.chainId,
            tag === "start" ? "down" : "up",
          );
        }),
      ),
    );
  };

  /** Updates `status` to record progress for each network. */
  const updateStatus = (
    events: RawEvent[],
    checkpoint: string,
    isRealtime: boolean,
  ) => {
    /**
     * If `realtimeSync` is defined for a network, use `localChain`
     * to find the most recently processed block for each network, and return.
     */
    if (isRealtime) {
      for (const [network, realtimeSync] of realtimeSyncs) {
        const localBlock = realtimeSync.localChain.findLast(
          (block) =>
            encodeCheckpoint(blockToCheckpoint(block, network.chainId, "up")) <=
            checkpoint,
        );
        if (localBlock !== undefined) {
          status[network.name]!.block = {
            timestamp: hexToNumber(localBlock.timestamp),
            number: hexToNumber(localBlock.number),
          };
        }
      }

      return;
    }

    /**
     * Otherwise, reverse iterate through `events` updating `status` for each network.
     */

    const staleNetworks = new Map<number, Network>();
    for (const [network] of localSyncs) {
      staleNetworks.set(network.chainId, network);
    }

    let i = events.length - 1;
    while (i >= 0 && staleNetworks.size > 0) {
      const event = events[i]!;

      if (staleNetworks.has(event.chainId)) {
        const network = staleNetworks.get(event.chainId)!;
        const { blockTimestamp, blockNumber } = decodeCheckpoint(
          event.checkpoint,
        );

        status[network.name]!.block = {
          timestamp: blockTimestamp,
          number: Number(blockNumber),
        };

        staleNetworks.delete(event.chainId);
      }

      i--;
    }

    /**
     * Additionally, use `latestBlock` to provide a more accurate `status
     * if it is available.
     */
    for (const [network, localSync] of localSyncs) {
      const latestBlock = localSync.latestBlock;
      if (latestBlock !== undefined) {
        status[network.name]!.block = {
          timestamp: hexToNumber(latestBlock.timestamp),
          number: hexToNumber(latestBlock.number),
        };
      }
    }
  };

  /**
   * Estimate optimal range (seconds) to query at a time, eventually
   * used to determine `to` passed to `getEvents`
   */
  let estimateSeconds = 10_000;
  /**
   * Omnichain `getEvents`
   *
   * Extract all events across `args.networks` ordered by checkpoint.
   * The generator is "completed" when all event have been extracted
   * before the minimum finalized checkpoint (supremum).
   *
   * Note: `syncStore.getEvents` is used to order between multiple
   * networks. This approach is not future proof.
   *
   * TODO(kyle) programmatically refetch finalized blocks to avoid exiting too early
   */
  async function* getEvents() {
    /**
     * Calculate checkpoints
     *
     * `start`: If `args.initial` is non-zero, use that. Otherwise,
     * use `start`
     *
     * `end`: If every network has an `endBlock` and its less than
     * `finalized`, use that. Otherwise, use `finalized`
     */
    const start =
      encodeCheckpoint(args.initialCheckpoint) !==
      encodeCheckpoint(zeroCheckpoint)
        ? encodeCheckpoint(args.initialCheckpoint)
        : getChainsCheckpoint("start")!;
    const end =
      getChainsCheckpoint("end") !== undefined &&
      getChainsCheckpoint("end")! < getChainsCheckpoint("finalized")!
        ? getChainsCheckpoint("end")!
        : getChainsCheckpoint("finalized")!;

    // Cursor used to track progress.
    let from = start;

    while (true) {
      const _localSyncs = args.networks.map(
        (network) => localSyncs.get(network)!,
      );
      // Sync the next interval of each chain.
      await Promise.all(_localSyncs.map((l) => l.sync()));
      /**
       * `latestBlock` is used to calculate the `to` checkpoint, if any
       * network hasn't yet ingested a block, run another iteration of this loop.
       * It is an invariant that `latestBlock` will eventually be defined. See the
       * implementation of `LocalSync.latestBlock` for more detail.
       */
      if (_localSyncs.some((l) => l.latestBlock === undefined)) continue;
      /**
       *  Calculate the mininum "latest" checkpoint, falling back to `end` if
       * all networks have completed.
       */
      const to = getChainsCheckpoint("latest") ?? end;

      /*
       * Extract events with `syncStore.getEvents()`, paginating to
       * avoid loading too many events into memory.
       */
      while (true) {
        if (isKilled) return;
        if (from === to) break;
        const getEventsMaxBatchSize = args.common.options.syncEventsQuerySize;
        // convert `estimateSeconds` to checkpoint
        const estimatedTo = encodeCheckpoint({
          ...zeroCheckpoint,
          blockTimestamp: Math.min(
            decodeCheckpoint(from).blockTimestamp + estimateSeconds,
            maxCheckpoint.blockTimestamp,
          ),
        });
        const { events, cursor } = await args.syncStore.getEvents({
          filters: args.sources.map(({ filter }) => filter),
          from,
          to: to < estimatedTo ? to : estimatedTo,
          limit: getEventsMaxBatchSize,
        });

        updateStatus(events, cursor, false);

        // Use range and number of events returned to update estimate
        // 10 <= estimate(new) <= estimate(prev) * 2
        estimateSeconds = Math.min(
          Math.max(
            10,
            Math.round(
              (getEventsMaxBatchSize * decodeCheckpoint(cursor).blockTimestamp -
                decodeCheckpoint(from).blockTimestamp) /
                (events.length || 1),
            ),
          ),
          estimateSeconds * 2,
        );

        yield { events, checkpoint: to };
        from = cursor;
      }

      // Exit condition: All network have completed historical sync.
      if (
        _localSyncs.every(
          (localSync) =>
            localSync.isComplete() ||
            localSync.finalizedBlock === localSync.latestBlock,
        )
      ) {
        break;
      }
    }
  }

  /**
   * Omnichain `onRealtimeSyncEvent`
   *
   * Handle callback events across all `args.networks`, and raising these
   * events to `args.onRealtimeEvent` while maintaining checkpoint ordering.
   *
   * Note: "block" events are still being handled by writing and reading from
   * the sync-store. This approach is not future proof and inefficient.
   */
  const eventQueue = createQueue({
    browser: false,
    concurrency: 1,
    initialStart: true,
    worker: async ({
      network,
      event,
    }: { network: Network; event: RealtimeSyncEvent }) => {
      const localSync = localSyncs.get(network)!;
      const realtimeSync = realtimeSyncs.get(network)!;
      switch (event.type) {
        /**
         * Handle a new block being ingested.
         */
        case "block":
          {
            const filters = args.sources
              .filter(({ filter }) => filter.chainId === network.chainId)
              .map(({ filter }) => filter);

            // Update local sync, record checkpoint before and after
            let from = getChainsCheckpoint("latest")!;
            localSync.latestBlock = event.block;
            const to = getChainsCheckpoint("latest")!;

            // Add block, logs, transactions, receipts, and traces to the sync-store.

            const chainId = network.chainId;

            await Promise.all([
              args.syncStore.insertBlock({ block: event.block, chainId }),
              args.syncStore.insertLogs({
                logs: event.logs.map((log) => ({ log, block: event.block })),
                chainId,
              }),
              args.syncStore.insertTransactions({
                transactions: event.transactions,
                chainId,
              }),
              args.syncStore.insertTransactionReceipts({
                transactionReceipts: event.transactionReceipts,
                chainId,
              }),
              args.syncStore.insertCallTraces({
                callTraces: event.callTraces.map((callTrace) => ({
                  callTrace,
                  block: event.block,
                })),
                chainId,
              }),
            ]);

            /*
             * Extract events with `syncStore.getEvents()`, paginating to
             * avoid loading too many events into memory.
             */
            while (true) {
              if (isKilled) return;
              if (from === to) break;
              const { events, cursor } = await args.syncStore.getEvents({
                filters,
                from,
                to,
                limit: args.common.options.syncEventsQuerySize,
              });

              updateStatus(events, cursor, true);
              args.onRealtimeEvent({ type: "block", checkpoint: to, events });

              from = cursor;
            }
          }
          break;
        /**
         * Handle a new block being finalized.
         */
        case "finalize":
          {
            // Newly finalized range
            const interval = [
              hexToNumber(localSync.finalizedBlock.number),
              hexToNumber(event.block.number),
            ] satisfies Interval;

            // Update local sync, record checkpoint before and after
            const prev = getChainsCheckpoint("finalized")!;
            localSync.finalizedBlock = event.block;
            const checkpoint = getChainsCheckpoint("finalized")!;

            const filters = args.sources
              .filter(({ filter }) => filter.chainId === network.chainId)
              .map(({ filter }) => filter);
            // Insert an interval for the newly finalized range.
            await Promise.all(
              filters.map((filter) =>
                args.syncStore.insertInterval({ filter, interval }),
              ),
            );

            // Raise event to parent function (runtime)
            if (checkpoint > prev) {
              args.onRealtimeEvent({ type: "finalize", checkpoint });
            }

            /**
             * The realtime service can be killed if `endBlock` is
             * defined has become finalized.
             */
            if (localSync.isComplete()) {
              args.common.logger.info({
                service: "sync",
                msg: `Synced final end block for '${network.name}' (${hexToNumber(localSync.endBlock!.number)}), killing realtime sync service`,
              });
              await realtimeSync.kill();
              // Delete syncs to remove `network` from checkpoint calculations
              localSyncs.delete(network);
              realtimeSyncs.delete(network);
            }
          }
          break;
        /**
         * Handle a reorg with a new common ancestor block being found.
         */
        case "reorg":
          {
            // Update local sync
            localSync.latestBlock = event.block;
            const checkpoint = getChainsCheckpoint("latest")!;

            await args.syncStore.pruneByBlock({
              fromBlock: hexToNumber(event.block.number),
              chainId: network.chainId,
            });

            args.onRealtimeEvent({ type: "reorg", checkpoint });
          }
          break;

        default:
          never(event);
      }
    },
  });

  return {
    getEvents,
    startRealtime() {
      for (const network of args.networks) {
        const localSync = localSyncs.get(network)!;

        // Update status
        status[network.name] = {
          block: {
            timestamp: hexToNumber(localSync.latestBlock!.timestamp),
            number: hexToNumber(localSync.latestBlock!.number),
          },
          ready: true,
        };

        // A `network` doesn't need a realtime sync if `endBlock` is finalized
        if (localSync.isComplete()) {
          // Delete sync to remove from checkpoint calculations
          localSyncs.delete(network);
        } else {
          // Create and start realtime sync
          const realtimeSync = createRealtimeSync({
            common: args.common,
            network,
            requestQueue: localSync.requestQueue,
            sources: args.sources.filter(
              ({ filter }) => filter.chainId === network.chainId,
            ),
            syncStore: args.syncStore,
            onEvent: (event) =>
              eventQueue.add({ network, event }).catch(args.onFatalError),
            onFatalError: args.onFatalError,
          });
          realtimeSync.start(localSync.finalizedBlock);
          realtimeSyncs.set(network, realtimeSync);
        }
      }
    },
    getStartCheckpoint() {
      return getChainsCheckpoint("start")!;
    },
    getFinalizedCheckpoint() {
      return getChainsCheckpoint("finalized")!;
    },
    getStatus() {
      return status;
    },
    getCachedTransport(network) {
      const { requestQueue } = localSyncs.get(network)!;
      return cachedTransport({ requestQueue, syncStore: args.syncStore });
    },
    async kill() {
      isKilled = true;
      const promises: Promise<void>[] = [];
      for (const network of args.networks) {
        /**
         * Some or all networks may be undefined, depending
         * on progress and `endBlock` configuration.
         */
        localSyncs.get(network)?.kill();
        const realtimeSync = realtimeSyncs.get(network);
        if (realtimeSync) promises.push(realtimeSync.kill());
      }

      eventQueue.pause();
      eventQueue.clear();
      promises.push(eventQueue.onIdle());

      await Promise.all(promises);
    },
  };
};
