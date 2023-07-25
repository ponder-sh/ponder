import Emittery from "emittery";
import { decodeEventLog, Hex } from "viem";

import { LogFilterName } from "@/build/handlers";
import { LogEventMetadata, LogFilter } from "@/config/logFilters";
import type { Network } from "@/config/networks";
import type { EventStore } from "@/event-store/store";
import { Common } from "@/Ponder";
import { Block } from "@/types/block";
import { Log } from "@/types/log";
import { Transaction } from "@/types/transaction";

export type LogEvent = {
  logFilterName: string;
  eventName: string;
  params: any;
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
  private common: Common;
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
    common,
    eventStore,
    networks,
    logFilters,
  }: {
    common: Common;
    eventStore: EventStore;
    networks: Network[];
    logFilters: LogFilter[];
  }) {
    super();

    this.common = common;
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
   * @param options.includeLogFilterEvents Map of log filter name -> selector -> ABI event item for which to include full event objects.
   * @returns A promise resolving to an array of log events.
   */
  async *getEvents({
    fromTimestamp,
    toTimestamp,
    includeLogFilterEvents,
  }: {
    fromTimestamp: number;
    toTimestamp: number;
    includeLogFilterEvents: {
      [logFilterName: LogFilterName]:
        | {
            bySelector: { [selector: Hex]: LogEventMetadata };
          }
        | undefined;
    };
  }) {
    const iterator = this.eventStore.getLogEvents({
      fromTimestamp,
      toTimestamp,
      filters: this.logFilters.map((logFilter) => ({
        name: logFilter.name,
        chainId: logFilter.filter.chainId,
        address: logFilter.filter.address,
        topics: logFilter.filter.topics,
        fromBlock: logFilter.filter.startBlock,
        toBlock: logFilter.filter.endBlock,
        includeEventSelectors: Object.keys(
          includeLogFilterEvents[logFilter.name]?.bySelector ?? {}
        ) as Hex[],
      })),
    });

    for await (const page of iterator) {
      const { events, metadata } = page;

      const decodedEvents = events.reduce<LogEvent[]>((acc, event) => {
        const selector = event.log.topics[0];
        if (!selector) {
          throw new Error(
            `Received an event log with no selector: ${event.log}`
          );
        }

        const logEventMetadata =
          includeLogFilterEvents[event.logFilterName]?.bySelector[selector];
        if (!logEventMetadata) {
          throw new Error(
            `Metadata for event ${event.logFilterName}:${selector} not found in includeLogFilterEvents`
          );
        }
        const { abiItem, safeName } = logEventMetadata;

        try {
          const decodedLog = decodeEventLog({
            abi: [abiItem],
            data: event.log.data,
            topics: event.log.topics,
          });

          acc.push({
            logFilterName: event.logFilterName,
            eventName: safeName,
            params: decodedLog.args || {},
            log: event.log,
            block: event.block,
            transaction: event.transaction,
          });
        } catch (err) {
          // TODO: emit a warning here that a log was not decoded.
          this.common.logger.error({
            service: "app",
            msg: `Unable to decode log (skipping it): ${event.log}`,
            error: err as Error,
          });
        }

        return acc;
      }, []);

      yield { events: decodedEvents, metadata };
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
