import { AbiEvent } from "abitype";
import Emittery from "emittery";
import { decodeEventLog, Hex } from "viem";

import { LogFilter } from "@/config/logFilters";
import type { Network } from "@/config/networks";
import type { EventStore } from "@/event-store/store";
import { Block } from "@/types/block";
import { Log } from "@/types/log";
import { Transaction } from "@/types/transaction";

export type LogEvent = {
  logFilterName: string;
  eventName: string;
  params: Record<string, unknown>;
  log: Log;
  block: Block;
  transaction: Transaction;
};

type EventAggregatorEvents = {
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

type EventAggregatorMetrics = {};

export class EventAggregatorService extends Emittery<EventAggregatorEvents> {
  private eventStore: EventStore;
  private logFilters: LogFilter[];
  private networks: Network[];

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

  metrics: EventAggregatorMetrics;

  constructor({
    eventStore,
    networks,
    logFilters,
  }: {
    eventStore: EventStore;
    networks: Network[];
    logFilters: LogFilter[];
  }) {
    super();

    this.eventStore = eventStore;
    this.logFilters = logFilters;
    this.networks = networks;
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
   * @param options.handledLogFilters Subset of log filters that the user has provided a handler for.
   * @returns A promise resolving to an array of log events.
   */
  getEvents = async ({
    fromTimestamp,
    toTimestamp,
    handledLogFilters,
  }: {
    fromTimestamp: number;
    toTimestamp: number;
    handledLogFilters: Record<
      string,
      {
        eventName: string;
        topic0: Hex;
        abiItem: AbiEvent;
      }[]
    >;
  }) => {
    const { events, totalEventCount } = await this.eventStore.getLogEvents({
      fromTimestamp,
      toTimestamp,
      filters: this.logFilters.map((logFilter) => ({
        name: logFilter.name,
        chainId: logFilter.filter.chainId,
        address: logFilter.filter.address,
        topics: logFilter.filter.topics,
        fromBlock: logFilter.filter.startBlock,
        toBlock: logFilter.filter.endBlock,
        handledTopic0: handledLogFilters[logFilter.name].map((i) => i.topic0),
      })),
    });

    const decodedEvents = events.reduce<LogEvent[]>((acc, event) => {
      // TODO: Improve decode performance by having the specific ABI event item ready.
      const logFilterData = handledLogFilters[event.filterName].find(
        (i) => i.topic0 === event.log.topics[0]
      );

      try {
        const decodedLog = decodeEventLog({
          abi: [logFilterData?.abiItem],
          data: event.log.data,
          topics: event.log.topics,
        });

        acc.push({
          logFilterName: event.filterName,
          eventName: decodedLog.eventName,
          params: decodedLog.args || {},
          log: event.log,
          block: event.block,
          transaction: event.transaction,
        });
      } catch (err) {
        // TODO: emit a warning here that an event was not decoded.
        // See https://github.com/0xOlias/ponder/issues/187
      }

      return acc;
    }, []);

    return {
      totalEventCount,
      events: decodedEvents,
    };
  };

  handleNewHistoricalCheckpoint = ({
    chainId,
    timestamp,
  }: {
    chainId: number;
    timestamp: number;
  }) => {
    this.networkCheckpoints[chainId].historicalCheckpoint = timestamp;
    this.recalculateCheckpoint();
  };

  handleHistoricalSyncComplete = ({ chainId }: { chainId: number }) => {
    this.networkCheckpoints[chainId].isHistoricalSyncComplete = true;
    this.recalculateCheckpoint();

    // If every network has completed the historical sync, set the metric.
    const networkCheckpoints = Object.values(this.networkCheckpoints);
    if (networkCheckpoints.every((n) => n.isHistoricalSyncComplete)) {
      const maxHistoricalCheckpoint = Math.max(
        ...networkCheckpoints.map((n) => n.historicalCheckpoint)
      );
      this.historicalSyncCompletedAt = maxHistoricalCheckpoint;
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

  private recalculateCheckpoint = () => {
    const checkpoints = Object.values(this.networkCheckpoints).map((n) =>
      n.isHistoricalSyncComplete
        ? Math.max(n.historicalCheckpoint, n.realtimeCheckpoint)
        : n.historicalCheckpoint
    );
    const newCheckpoint = Math.min(...checkpoints);

    if (newCheckpoint > this.checkpoint) {
      this.checkpoint = newCheckpoint;
      this.emit("newCheckpoint", { timestamp: this.checkpoint });
    }
  };

  private recalculateFinalityCheckpoint = () => {
    const newFinalityCheckpoint = Math.min(
      ...Object.values(this.networkCheckpoints).map((n) => n.finalityCheckpoint)
    );

    if (newFinalityCheckpoint > this.finalityCheckpoint) {
      this.finalityCheckpoint = newFinalityCheckpoint;
      this.emit("newFinalityCheckpoint", {
        timestamp: this.finalityCheckpoint,
      });
    }
  };
}
