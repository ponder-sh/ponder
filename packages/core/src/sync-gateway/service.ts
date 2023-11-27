import Emittery from "emittery";
import type { Hex } from "viem";

import type { Network } from "@/config/networks.js";
import type { Source } from "@/config/sources.js";
import { sourceIsFactory, sourceIsLogFilter } from "@/config/sources.js";
import type { Common } from "@/Ponder.js";
import type { SyncStore } from "@/sync-store/store.js";
import {
  checkpointMax,
  checkpointMin,
  type EventCheckpoint,
} from "@/utils/checkpoint.js";
import { formatShortDate } from "@/utils/date.js";

type SyncGatewayEvents = {
  /**
   * Emitted when a new event checkpoint is reached. This is the minimum timestamp
   * at which events are available across all registered networks.
   */
  newCheckpoint: EventCheckpoint;
  /**
   * Emitted when a new finality checkpoint is reached. This is the minimum timestamp
   * at which events are finalized across all registered networks.
   */
  newFinalityCheckpoint: EventCheckpoint;
  /**
   * Emitted when a reorg has been detected on any registered network. The value
   * is the safe/"common ancestor" checkpoint.
   */
  reorg: EventCheckpoint;
};

type SyncGatewayMetrics = {};

export class SyncGateway extends Emittery<SyncGatewayEvents> {
  private common: Common;
  private syncStore: SyncStore;
  private networks: Network[];
  private sources: Source[];

  // Minimum timestamp at which events are available (across all networks).
  checkpoint: EventCheckpoint;
  // Minimum finalized timestamp (across all networks).
  finalityCheckpoint: EventCheckpoint;

  // Per-network event timestamp checkpoints.
  private networkCheckpoints: Record<
    number,
    {
      isHistoricalSyncComplete: boolean;
      historicalCheckpoint: EventCheckpoint;
      realtimeCheckpoint: EventCheckpoint;
      finalityCheckpoint: EventCheckpoint;
    }
  >;

  // Timestamp at which the historical sync was completed (across all networks).
  historicalSyncCompletedAt?: number;

  metrics: SyncGatewayMetrics;

  constructor({
    common,
    syncStore,
    networks,
    sources = [],
  }: {
    common: Common;
    syncStore: SyncStore;
    networks: Network[];
    sources?: Source[];
  }) {
    super();

    this.common = common;
    this.syncStore = syncStore;
    this.networks = networks;
    this.sources = sources;
    this.metrics = {};

    this.checkpoint = { blockTimestamp: 0, chainId: 0, blockNumber: 0 };
    this.finalityCheckpoint = { blockTimestamp: 0, chainId: 0, blockNumber: 0 };

    this.networkCheckpoints = {};
    this.networks.forEach((network) => {
      const { chainId } = network;
      this.networkCheckpoints[chainId] = {
        isHistoricalSyncComplete: false,
        historicalCheckpoint: { blockTimestamp: 0, chainId, blockNumber: 0 },
        realtimeCheckpoint: { blockTimestamp: 0, chainId, blockNumber: 0 },
        finalityCheckpoint: { blockTimestamp: 0, chainId, blockNumber: 0 },
      };
    });
  }

  /** Fetches events for all registered log filters between the specified timestamps.
   *
   * @param options.fromTimestamp Timestamp to start including events (inclusive).
   * @param options.toTimestamp Timestamp to stop including events (inclusive).
   * @param options.includeLogFilterEvents Map of log filter name -> selector -> ABI event item for which to include full event objects.
   * @returns A promise resolving to an array of log events.
   */
  async *getEvents({
    fromCheckpoint,
    toCheckpoint,
    includeEventSelectors,
  }: {
    fromCheckpoint: EventCheckpoint;
    toCheckpoint: EventCheckpoint;
    includeEventSelectors: { [sourceId: string]: Hex[] };
  }) {
    const iterator = this.syncStore.getLogEvents({
      fromCheckpoint,
      toCheckpoint,
      logFilters: this.sources.filter(sourceIsLogFilter).map((logFilter) => ({
        id: logFilter.id,
        chainId: logFilter.chainId,
        criteria: logFilter.criteria,
        fromBlock: logFilter.startBlock,
        toBlock: logFilter.endBlock,
        includeEventSelectors: includeEventSelectors[logFilter.id],
      })),
      factories: this.sources.filter(sourceIsFactory).map((factory) => ({
        id: factory.id,
        chainId: factory.chainId,
        criteria: factory.criteria,
        fromBlock: factory.startBlock,
        toBlock: factory.endBlock,
        includeEventSelectors: includeEventSelectors[factory.id],
      })),
    });

    for await (const page of iterator) {
      yield page;
    }
  }

  handleNewHistoricalCheckpoint = (checkpoint: EventCheckpoint) => {
    const { blockTimestamp, chainId } = checkpoint;

    this.networkCheckpoints[chainId].historicalCheckpoint = checkpoint;

    this.common.logger.trace({
      service: "gateway",
      msg: `New historical checkpoint at ${blockTimestamp} [${formatShortDate(
        blockTimestamp,
      )}] (chainId=${chainId})`,
    });

    this.recalculateCheckpoint();
  };

  handleHistoricalSyncComplete = ({ chainId }: { chainId: number }) => {
    this.networkCheckpoints[chainId].isHistoricalSyncComplete = true;
    this.recalculateCheckpoint();

    // If every network has completed the historical sync, set the metric.
    const networkCheckpoints = Object.values(this.networkCheckpoints);
    if (networkCheckpoints.every((n) => n.isHistoricalSyncComplete)) {
      const maxHistoricalCheckpoint = checkpointMax(
        ...networkCheckpoints.map((n) => n.historicalCheckpoint),
      );
      this.historicalSyncCompletedAt = maxHistoricalCheckpoint.blockTimestamp;

      this.common.logger.debug({
        service: "gateway",
        msg: `Completed historical sync across all networks`,
      });
    }
  };

  handleNewRealtimeCheckpoint = (checkpoint: EventCheckpoint) => {
    const { blockTimestamp, chainId } = checkpoint;

    this.networkCheckpoints[chainId].realtimeCheckpoint = checkpoint;

    this.common.logger.trace({
      service: "gateway",
      msg: `New realtime checkpoint at ${blockTimestamp} [${formatShortDate(
        blockTimestamp,
      )}] (chainId=${chainId})`,
    });

    this.recalculateCheckpoint();
  };

  handleNewFinalityCheckpoint = (checkpoint: EventCheckpoint) => {
    const { chainId } = checkpoint;

    this.networkCheckpoints[chainId].finalityCheckpoint = checkpoint;
    this.recalculateFinalityCheckpoint();
  };

  handleReorg = (checkpoint: EventCheckpoint) => {
    this.emit("reorg", checkpoint);
  };

  /** Resets global checkpoints as well as the network checkpoint for the specified chain ID.
   *  Keeps previous checkpoint values for other networks.
   *
   * @param options.chainId Chain ID for which to reset the checkpoint.
   */
  resetCheckpoints = ({ chainId }: { chainId: number }) => {
    this.checkpoint = 0;
    this.finalityCheckpoint = 0;
    this.historicalSyncCompletedAt = 0;
    this.networkCheckpoints[chainId] = {
      isHistoricalSyncComplete: false,
      historicalCheckpoint: 0,
      realtimeCheckpoint: 0,
      finalityCheckpoint: 0,
    };
  };

  private recalculateCheckpoint = () => {
    const checkpoints = Object.values(this.networkCheckpoints).map((n) =>
      n.isHistoricalSyncComplete
        ? checkpointMax(n.historicalCheckpoint, n.realtimeCheckpoint)
        : n.historicalCheckpoint,
    );
    const newCheckpoint = checkpointMin(...checkpoints);

    if (newCheckpoint > this.checkpoint) {
      this.checkpoint = newCheckpoint;

      const timestamp = this.checkpoint.blockTimestamp;
      this.common.logger.trace({
        service: "gateway",
        msg: `New event checkpoint at ${timestamp} [${formatShortDate(
          timestamp,
        )}]`,
      });

      this.emit("newCheckpoint", this.checkpoint);
    }
  };

  private recalculateFinalityCheckpoint = () => {
    const newFinalityCheckpoint = checkpointMin(
      ...Object.values(this.networkCheckpoints).map(
        (n) => n.finalityCheckpoint,
      ),
    );

    if (newFinalityCheckpoint > this.finalityCheckpoint) {
      this.finalityCheckpoint = newFinalityCheckpoint;

      const timestamp = this.finalityCheckpoint.blockTimestamp;
      this.common.logger.trace({
        service: "gateway",
        msg: `New finality checkpoint at ${timestamp} [${formatShortDate(
          timestamp,
        )}]`,
      });

      this.emit("newFinalityCheckpoint", this.finalityCheckpoint);
    }
  };
}
