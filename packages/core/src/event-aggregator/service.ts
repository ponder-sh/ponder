import Emittery from "emittery";
import { decodeEventLog } from "viem";

import { LogFilter } from "@/config/logFilters";
import type { Network } from "@/config/networks";
import type { EventStore } from "@/event-store/store";
import { isLogMatchedByFilter } from "@/realtime-sync/filter";
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
  eventsAvailable: { toTimestamp: number };
  finalityCheckpoint: { safeTimestamp: number };
  reorg: { commonAncestorTimestamp: number };
};

type EventAggregatorMetrics = {};

export class EventAggregatorService extends Emittery<EventAggregatorEvents> {
  private store: EventStore;
  private logFilters: LogFilter[];
  private networks: Network[];

  // Minimum timestamp that historical events are available for (across all networks).
  private historicalCheckpoint: number;
  // Minimum timestamp that realtime events are available for (across all networks).
  private realtimeCheckpoint: number;
  // Minimum finalized timestamp (across all networks).
  private finalityCheckpoint: number;

  // Per-network event timestamp checkpoints.
  private networkCheckpoints: Record<
    number,
    {
      historicalCheckpoint: number;
      realtimeCheckpoint: number;
      finalityCheckpoint: number;
    }
  >;

  metrics: EventAggregatorMetrics;

  constructor({
    store,
    networks,
    logFilters,
  }: {
    store: EventStore;
    networks: Network[];
    logFilters: LogFilter[];
  }) {
    super();

    this.store = store;
    this.logFilters = logFilters;
    this.networks = networks;
    this.metrics = {};

    this.historicalCheckpoint = 0;
    this.realtimeCheckpoint = 0;
    this.finalityCheckpoint = 0;

    this.networkCheckpoints = {};
    this.networks.forEach((network) => {
      this.networkCheckpoints[network.chainId] = {
        historicalCheckpoint: 0,
        realtimeCheckpoint: 0,
        finalityCheckpoint: 0,
      };
    });
  }

  getEvents = async ({
    fromTimestamp,
    toTimestamp,
  }: {
    fromTimestamp: number;
    toTimestamp: number;
  }) => {
    const events = await this.store.getLogEvents({
      fromTimestamp,
      toTimestamp,
      filters: this.logFilters.map((logFilter) => ({
        chainId: logFilter.network.chainId,
        address: logFilter.filter.address,
        topics: logFilter.filter.topics,
      })),
    });

    // Ugly step. We need to associate events with a log filter. There may be duplicates.
    const hydratedEvents = events.reduce<LogEvent[]>((acc, event) => {
      const matchedLogFilters = this.logFilters.filter((logFilter) =>
        isLogMatchedByFilter({
          log: event.log,
          address: logFilter.filter.address,
          topics: logFilter.filter.topics,
        })
      );

      matchedLogFilters.forEach((logFilter) => {
        try {
          const decodedLog = decodeEventLog({
            abi: logFilter.abi,
            data: event.log.data,
            topics: event.log.topics,
          });

          acc.push({
            logFilterName: logFilter.name,
            eventName: decodedLog.eventName,
            params: decodedLog.args || {},
            log: event.log,
            block: event.block,
            transaction: event.transaction,
          });
        } catch (err) {
          // pass
        }
      });

      return acc;
    }, []);

    return hydratedEvents;
  };

  handleNewHistoricalCheckpoint = ({
    chainId,
    timestamp,
  }: {
    chainId: number;
    timestamp: number;
  }) => {
    this.networkCheckpoints[chainId].historicalCheckpoint = timestamp;

    const newHistoricalCheckpoint = Math.min(
      ...Object.values(this.networkCheckpoints).map(
        (n) => n.historicalCheckpoint
      )
    );

    if (newHistoricalCheckpoint > this.historicalCheckpoint) {
      this.historicalCheckpoint = newHistoricalCheckpoint;
      this.emit("eventsAvailable", { toTimestamp: this.historicalCheckpoint });
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

    const newRealtimeCheckpoint = Math.min(
      ...Object.values(this.networkCheckpoints).map((n) => n.realtimeCheckpoint)
    );

    if (newRealtimeCheckpoint > this.realtimeCheckpoint) {
      this.realtimeCheckpoint = newRealtimeCheckpoint;
      this.emit("eventsAvailable", { toTimestamp: this.realtimeCheckpoint });
    }
  };

  handleNewFinalityCheckpoint = ({
    chainId,
    timestamp,
  }: {
    chainId: number;
    timestamp: number;
  }) => {
    this.networkCheckpoints[chainId].finalityCheckpoint = timestamp;

    const newFinalityCheckpoint = Math.min(
      ...Object.values(this.networkCheckpoints).map((n) => n.finalityCheckpoint)
    );

    if (newFinalityCheckpoint > this.finalityCheckpoint) {
      this.finalityCheckpoint = newFinalityCheckpoint;
      this.emit("eventsAvailable", { toTimestamp: this.finalityCheckpoint });
    }
  };

  handleReorg = ({ timestamp }: { timestamp: number }) => {
    this.emit("reorg", { commonAncestorTimestamp: timestamp });
  };
}
