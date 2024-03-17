import type { Common } from "@/common/common.js";
import type { Network } from "@/config/networks.js";
import type {
  FactoryCriteria,
  LogFilterCriteria,
  Source,
} from "@/config/sources.js";
import { HistoricalSyncService } from "@/sync-historical/service.js";
import { RealtimeSyncService } from "@/sync-realtime/service.js";
import type { SyncStore } from "@/sync-store/store.js";
import {
  type Checkpoint,
  checkpointMin,
  isCheckpointGreaterThan,
  zeroCheckpoint,
} from "@/utils/checkpoint.js";
import { Emittery } from "@/utils/emittery.js";
import { type RequestQueue, createRequestQueue } from "@/utils/requestQueue.js";
import type { Hex, Transport } from "viem";
import { cachedTransport } from "./transport.js";

type SyncServiceEvents = {
  /**
   * Emitted when a new event checkpoint is reached. This is the minimum timestamp
   * at which events are available across all registered networks.
   */
  checkpoint: Checkpoint;
  /**
   * Emitted when a new finality checkpoint is reached. This is the minimum timestamp
   * at which events are finalized across all registered networks.
   */
  finalityCheckpoint: Checkpoint;
  /**
   * Emitted when a reorg has been detected on any registered network. The value
   * is the safe/"common ancestor" checkpoint.
   */
  reorg: Checkpoint;
  /**
   * Emitted when the historical sync has completed across all registered networks.
   */
  hasCompletedHistoricalSync: Checkpoint;
  /**
   * Emitted when an unrecovable error has occurred.
   */
  fatal: Error;
};

export class SyncService extends Emittery<SyncServiceEvents> {
  private common: Common;
  private syncStore: SyncStore;
  private sources: Source[];

  // Minimum timestamp at which events are available (across all networks).
  checkpoint: Checkpoint;
  // Minimum finalized timestamp (across all networks).
  finalityCheckpoint: Checkpoint;
  // Is historical sync complete across all networks.
  isHistoricalSyncComplete = false;

  // Per-network event timestamp checkpoints.
  private networks: Record<
    number,
    {
      network: Network;
      sources: Source[];
      requestQueue: RequestQueue;
      cachedTransport: Transport;

      historical: HistoricalSyncService;
      realtime: RealtimeSyncService;

      isHistoricalSyncComplete: boolean;
      historicalCheckpoint: Checkpoint;
      realtimeCheckpoint: Checkpoint;
      finalityCheckpoint: Checkpoint;
    }
  >;

  constructor({
    common,
    syncStore,
    networks,
    sources,
  }: {
    common: Common;
    syncStore: SyncStore;
    networks: Network[];
    sources: Source[];
  }) {
    super();

    this.common = common;
    this.syncStore = syncStore;
    this.sources = sources;

    this.checkpoint = zeroCheckpoint;
    this.finalityCheckpoint = zeroCheckpoint;

    this.networks = {};
    networks.forEach((network) => {
      const { chainId } = network;
      const sourcesForNetwork = this.sources.filter(
        (source) => source.networkName === network.name,
      );

      const requestQueue = createRequestQueue({
        network,
        metrics: common.metrics,
      });

      const historical = new HistoricalSyncService({
        common: this.common,
        syncStore: this.syncStore,
        network,
        requestQueue,
        sources: sourcesForNetwork,
      });

      const realtime = new RealtimeSyncService({
        common: this.common,
        syncStore: this.syncStore,
        network,
        requestQueue,
        sources: sourcesForNetwork,
      });

      this.networks[chainId] = {
        network,
        requestQueue,
        cachedTransport: cachedTransport({ requestQueue, syncStore }),
        sources: sourcesForNetwork,
        historical,
        realtime,
        isHistoricalSyncComplete: false,
        historicalCheckpoint: zeroCheckpoint,
        realtimeCheckpoint: zeroCheckpoint,
        finalityCheckpoint: zeroCheckpoint,
      };

      historical.on("historicalCheckpoint", (checkpoint) => {
        this.handleNewHistoricalCheckpoint(checkpoint);
      });

      historical.on("syncComplete", () => {
        this.handleHistoricalSyncComplete({ chainId });
      });

      realtime.on("realtimeCheckpoint", (checkpoint) => {
        this.handleNewRealtimeCheckpoint(checkpoint);
      });

      realtime.on("finalityCheckpoint", (checkpoint) => {
        this.handleNewFinalityCheckpoint(checkpoint);
      });

      realtime.on("shallowReorg", (checkpoint) => {
        this.handleReorg(checkpoint);
      });

      realtime.on("fatal", (error) => {
        this.common.logger.fatal({
          service: "app",
          msg: "Realtime sync service failed",
        });
        this.emit("fatal", error);
      });
    });
  }

  async start() {
    try {
      await Promise.all(
        Object.values(this.networks).map(async ({ historical, realtime }) => {
          const blockNumbers = await realtime.setup();
          await historical.setup(blockNumbers);
          historical.start();
          realtime.start();
        }),
      );
    } catch (error_) {
      const error = error_ as Error;
      error.stack = undefined;
      this.emit("fatal", error);
    }
  }

  async kill() {
    this.clearListeners();

    await Promise.all(
      Object.values(this.networks).map(
        async ({ historical, realtime, requestQueue }) => {
          // Note that these methods pause, clear the queues
          // and set a boolean flag that allows tasks to fail silently with no retries.
          realtime.kill();
          historical.kill();
          // TODO: Update this once viem supports canceling requests.
          requestQueue.clear();
          await requestQueue.onIdle();
        },
      ),
    );
  }

  /** Fetches events for all registered log filters between the specified checkpoints.
   *
   * @param options.fromCheckpoint Checkpoint to include events from (exclusive).
   * @param options.toCheckpoint Checkpoint to include events to (inclusive).
   */
  getEvents(
    arg: {
      fromCheckpoint: Checkpoint;
      toCheckpoint: Checkpoint;
      limit: number;
    } & (
      | {
          logFilters: {
            id: string;
            chainId: number;
            criteria: LogFilterCriteria;
            fromBlock?: number;
            toBlock?: number;
            eventSelector: Hex;
          }[];
          factories?: undefined;
        }
      | {
          logFilters?: undefined;
          factories: {
            id: string;
            chainId: number;
            criteria: FactoryCriteria;
            fromBlock?: number;
            toBlock?: number;
            eventSelector: Hex;
          }[];
        }
    ),
  ) {
    return this.syncStore.getLogEvents(arg);
  }

  getCachedTransport(chainId: number) {
    return this.networks[chainId].cachedTransport;
  }

  handleNewHistoricalCheckpoint = (checkpoint: Checkpoint) => {
    const { blockTimestamp, chainId, blockNumber } = checkpoint;

    this.networks[chainId].historicalCheckpoint = checkpoint;

    this.common.logger.trace({
      service: "gateway",
      msg: `New historical checkpoint (timestamp=${blockTimestamp} chainId=${chainId} blockNumber=${blockNumber})`,
    });

    this.recalculateCheckpoint();
  };

  handleHistoricalSyncComplete = ({ chainId }: { chainId: number }) => {
    this.networks[chainId].isHistoricalSyncComplete = true;
    this.recalculateCheckpoint();

    // If every network has completed the historical sync, set the metric.
    const networkCheckpoints = Object.values(this.networks);
    if (networkCheckpoints.every((n) => n.isHistoricalSyncComplete)) {
      this.isHistoricalSyncComplete = true;
      this.common.logger.debug({
        service: "gateway",
        msg: "Completed historical sync across all networks",
      });
    }
  };

  handleNewRealtimeCheckpoint = (checkpoint: Checkpoint) => {
    const { blockTimestamp, chainId, blockNumber } = checkpoint;

    this.networks[chainId].realtimeCheckpoint = checkpoint;

    this.common.logger.trace({
      service: "gateway",
      msg: `New realtime checkpoint at (timestamp=${blockTimestamp} chainId=${chainId} blockNumber=${blockNumber})`,
    });

    this.recalculateCheckpoint();
  };

  handleNewFinalityCheckpoint = (checkpoint: Checkpoint) => {
    const { chainId } = checkpoint;

    this.networks[chainId].finalityCheckpoint = checkpoint;
    this.recalculateFinalityCheckpoint();
  };

  handleReorg = (checkpoint: Checkpoint) => {
    this.emit("reorg", checkpoint);
  };

  private recalculateCheckpoint = () => {
    const newCheckpoint = checkpointMin(
      ...Object.values(this.networks).map((n) =>
        n.isHistoricalSyncComplete
          ? n.realtimeCheckpoint
          : n.historicalCheckpoint,
      ),
    );

    if (isCheckpointGreaterThan(newCheckpoint, this.checkpoint)) {
      this.checkpoint = newCheckpoint;

      const { chainId, blockTimestamp, blockNumber } = this.checkpoint;
      this.common.logger.trace({
        service: "gateway",
        msg: `New checkpoint (timestamp=${blockTimestamp} chainId=${chainId} blockNumber=${blockNumber})`,
      });

      this.emit("checkpoint", this.checkpoint);
    }
  };

  private recalculateFinalityCheckpoint = () => {
    const newFinalityCheckpoint = checkpointMin(
      ...Object.values(this.networks).map((n) => n.finalityCheckpoint),
    );

    if (
      isCheckpointGreaterThan(newFinalityCheckpoint, this.finalityCheckpoint)
    ) {
      this.finalityCheckpoint = newFinalityCheckpoint;

      const { chainId, blockTimestamp, blockNumber } = this.finalityCheckpoint;
      this.common.logger.trace({
        service: "gateway",
        msg: `New finality checkpoint (timestamp=${blockTimestamp} chainId=${chainId} blockNumber=${blockNumber})`,
      });

      this.emit("finalityCheckpoint", this.finalityCheckpoint);
    }
  };
}
