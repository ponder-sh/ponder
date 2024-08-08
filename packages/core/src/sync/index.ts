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
  isCheckpointEqual,
  maxCheckpoint,
  zeroCheckpoint,
} from "@/utils/checkpoint.js";
import type { Interval } from "@/utils/interval.js";
import { never } from "@/utils/never.js";
import { type Transport, hexToBigInt, hexToNumber } from "viem";
import { _eth_getBlockByNumber } from "../utils/rpc.js";
import type { RawEvent } from "./events.js";
import { type LocalSync, createLocalSync } from "./local.js";
import type { Source } from "./source.js";
import { cachedTransport } from "./transport.js";

export type Sync = {
  getEvents(): AsyncGenerator<RawEvent[]>;
  startRealtime(): void;
  getStatus(): Status;
  /** Return the minimum finalized checkpoint (supremum) for all networks. */
  getFinalizedCheckpoint(): string;
  getCachedTransport(network: Network): Transport;
  kill(): Promise<void>;
};

export type RealtimeEvent =
  | {
      type: "block";
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
  const getChainsCheckpoint = <
    tag extends "start" | "latest" | "finalized" | "end",
  >(
    tag: tag,
  ): tag extends "end" ? string | undefined : string => {
    if (
      tag === "end" &&
      args.networks.some(
        (network) => localSyncs.get(network)!.endBlock === undefined,
      )
    ) {
      return undefined as any;
    }

    const checkpoints = args.networks.map((network) => {
      const localSync = localSyncs.get(network)!;
      const block = localSync[`${tag}Block`]!;

      // The checkpoint returned by this function is meant to be used in
      // a closed interval (includes endpoints), so "start" should be inclusive.
      return blockToCheckpoint(
        block,
        network.chainId,
        tag === "start" ? "down" : "up",
      );
    });
    return encodeCheckpoint(checkpointMin(...checkpoints)) as any;
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

    const staleNetworks = new Set<number>();
    for (const [network] of localSyncs) {
      staleNetworks.add(network.chainId);
    }

    let i = events.length - 1;
    while (i >= 0 && staleNetworks.size > 0) {
      const event = events[i]!;

      if (staleNetworks.has(event.chainId)) {
        const network = args.networks.find(
          (network) => network.chainId === event.chainId,
        )!;
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
    const start =
      isCheckpointEqual(args.initialCheckpoint, zeroCheckpoint) === false
        ? encodeCheckpoint(args.initialCheckpoint)
        : getChainsCheckpoint("start");
    const end = getChainsCheckpoint("end") ?? getChainsCheckpoint("finalized");

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
      // Calculate the mininum "latest" checkpoint.
      const to = getChainsCheckpoint("latest");

      /*
       * Extract events with `syncStore.getEvents()`, paginating to
       * avoid loading too many events into memory.
       */
      while (true) {
        if (from === to) break;
        // TODO(kyle) may be more performant to self-limit `to`
        const { events, cursor } = await args.syncStore.getEvents({
          filters: args.sources.map(({ filter }) => filter),
          from,
          to,
          limit: 10_000,
        });

        updateStatus(events, cursor, false);

        yield events;
        from = cursor;
      }
      if (to >= end) break;
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
   *
   * TODO(kyle) is async bad?
   * TODO(kyle) handle errors
   */
  const onEvent = (network: Network) => async (event: RealtimeSyncEvent) => {
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
          let from = getChainsCheckpoint("latest");
          localSync.latestBlock = event.block;
          const to = getChainsCheckpoint("latest");

          // Add block, logs, transactions, receipts, and traces to the sync-store.

          const promises: Promise<void>[] = [];
          const chainId = network.chainId;
          promises.push(
            args.syncStore.insertBlock({ block: event.block, chainId }),
          );
          if (event.logs.length > 0) {
            promises.push(
              args.syncStore.insertLogs({
                logs: event.logs.map((log) => ({ log, block: event.block })),
                chainId,
              }),
            );
          }
          if (event.transactions.length > 0) {
            promises.push(
              args.syncStore.insertTransactions({
                transactions: event.transactions,
                chainId,
              }),
            );
          }
          if (event.transactionReceipts.length > 0) {
            promises.push(
              args.syncStore.insertTransactionReceipts({
                transactionReceipts: event.transactionReceipts,
                chainId,
              }),
            );
          }
          if (event.callTraces.length > 0) {
            promises.push(
              args.syncStore.insertCallTraces({
                callTraces: event.callTraces.map((callTrace) => ({
                  callTrace,
                  block: event.block,
                })),
                chainId,
              }),
            );
          }

          await Promise.all(promises);

          /*
           * Extract events with `syncStore.getEvents()`, paginating to
           * avoid loading too many events into memory.
           */
          while (true) {
            if (from === to) break;
            const { events, cursor } = await args.syncStore.getEvents({
              filters,
              from,
              to,
              limit: 10_000,
            });

            updateStatus(events, cursor, true);
            args.onRealtimeEvent({ type: "block", events });

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
          const prev = getChainsCheckpoint("finalized");
          localSync.finalizedBlock = event.block;
          const checkpoint = getChainsCheckpoint("finalized");

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
          const checkpoint = getChainsCheckpoint("latest");

          // await args.syncStore.pruneByBlock();

          args.onRealtimeEvent({ type: "reorg", checkpoint });
        }
        break;

      default:
        never(event);
    }
  };

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
            onEvent: onEvent(network),
            onFatalError: args.onFatalError,
          });
          realtimeSync.start(localSync.finalizedBlock);
          realtimeSyncs.set(network, realtimeSync);
        }
      }
    },
    getFinalizedCheckpoint() {
      return getChainsCheckpoint("finalized");
    },
    getStatus() {
      return status;
    },
    getCachedTransport(network) {
      const { requestQueue } = localSyncs.get(network)!;
      return cachedTransport({ requestQueue, syncStore: args.syncStore });
    },
    async kill() {
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
      await Promise.all(promises);
    },
  };
};
