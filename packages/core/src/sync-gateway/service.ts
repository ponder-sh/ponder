import Emittery from "emittery";
import type { Hex } from "viem";

import type { Network } from "@/config/networks.js";
import type { Source } from "@/config/sources.js";
import { sourceIsFactory, sourceIsLogFilter } from "@/config/sources.js";
import type { Common } from "@/Ponder.js";
import type { SyncStore } from "@/sync-store/store.js";
import { formatShortDate } from "@/utils/date.js";

type SyncGatewayEvents = {
  /**
   * Emitted when a new event checkpoint is reached. This is the minimum timestamp
   * at which events are available across all registered networks.
   */
  newCheckpoint: { timestamp: number };
  /**
   * Emitted when a new finality checkpoint is reached. This is the minimum timestamp
   * at which events are finalized across all registered networks.
   */
  newFinalityCheckpoint: { timestamp: number };
  /**
   * Emitted when a reorg has been detected on any registered network.
   */
  reorg: { commonAncestorTimestamp: number };
};

type SyncGatewayMetrics = {};

export class SyncGateway extends Emittery<SyncGatewayEvents> {
  private common: Common;
  private syncStore: SyncStore;
  private networks: Network[];
  private sources: Source[];

  // Minimum timestamp at which events are available (across all networks).
  checkpoint: number;
  // Minimum finalized timestamp (across all networks).
  finalityCheckpoint: number;

  // Timestamp at which the historical sync was completed (across all networks).
  historicalSyncCompletedAt?: number;

  // Per-network event timestamp checkpoints.
  private networkCheckpoints: Record<
    number,
    {
      isHistoricalSyncComplete: boolean;
      historicalCheckpoint: number;
      realtimeCheckpoint: number;
      finalityCheckpoint: number;
    }
  >;

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

    this.checkpoint = 0;
    this.finalityCheckpoint = 0;

    this.networkCheckpoints = {};
    this.networks.forEach((network) => {
      this.networkCheckpoints[network.chainId] = {
        isHistoricalSyncComplete: false,
        historicalCheckpoint: 0,
        realtimeCheckpoint: 0,
        finalityCheckpoint: 0,
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
    fromTimestamp,
    toTimestamp,
    includeEventSelectors,
  }: {
    fromTimestamp: number;
    toTimestamp: number;
    includeEventSelectors: { [sourceId: string]: Hex[] };
  }) {
    const iterator = this.syncStore.getLogEvents({
      fromTimestamp,
      toTimestamp,
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

  handleNewHistoricalCheckpoint = ({
    chainId,
    timestamp,
  }: {
    chainId: number;
    timestamp: number;
  }) => {
    this.networkCheckpoints[chainId].historicalCheckpoint = timestamp;

    this.common.logger.trace({
      service: "gateway",
      msg: `New historical checkpoint at ${timestamp} [${formatShortDate(
        timestamp,
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
      const maxHistoricalCheckpoint = Math.max(
        ...networkCheckpoints.map((n) => n.historicalCheckpoint),
      );
      this.historicalSyncCompletedAt = maxHistoricalCheckpoint;

      this.common.logger.debug({
        service: "gateway",
        msg: `Completed historical sync across all networks`,
      });
    }
  };

  handleNewRealtimeCheckpoint = ({
    chainId,
    timestamp,
  }: {
    chainId: number;
    timestamp: number;
  }) => {
    this.networkCheckpoints[chainId].realtimeCheckpoint = timestamp;

    this.common.logger.trace({
      service: "gateway",
      msg: `New realtime checkpoint at ${timestamp} [${formatShortDate(
        timestamp,
      )}] (chainId=${chainId})`,
    });

    this.recalculateCheckpoint();
  };

  handleNewFinalityCheckpoint = ({
    chainId,
    timestamp,
  }: {
    chainId: number;
    timestamp: number;
  }) => {
    this.networkCheckpoints[chainId].finalityCheckpoint = timestamp;
    this.recalculateFinalityCheckpoint();
  };

  handleReorg = ({
    commonAncestorTimestamp,
  }: {
    commonAncestorTimestamp: number;
  }) => {
    this.emit("reorg", { commonAncestorTimestamp });
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
        ? Math.max(n.historicalCheckpoint, n.realtimeCheckpoint)
        : n.historicalCheckpoint,
    );
    const newCheckpoint = Math.min(...checkpoints);

    if (newCheckpoint > this.checkpoint) {
      this.checkpoint = newCheckpoint;

      this.common.logger.trace({
        service: "gateway",
        msg: `New event checkpoint at ${this.checkpoint} [${formatShortDate(
          this.checkpoint,
        )}]`,
      });

      this.emit("newCheckpoint", { timestamp: this.checkpoint });
    }
  };

  private recalculateFinalityCheckpoint = () => {
    const newFinalityCheckpoint = Math.min(
      ...Object.values(this.networkCheckpoints).map(
        (n) => n.finalityCheckpoint,
      ),
    );

    if (newFinalityCheckpoint > this.finalityCheckpoint) {
      this.finalityCheckpoint = newFinalityCheckpoint;

      this.common.logger.trace({
        service: "gateway",
        msg: `New finality checkpoint at ${
          this.finalityCheckpoint
        } [${formatShortDate(this.finalityCheckpoint)}]`,
      });

      this.emit("newFinalityCheckpoint", {
        timestamp: this.finalityCheckpoint,
      });
    }
  };
}
