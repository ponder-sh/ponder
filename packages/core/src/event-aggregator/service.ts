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
  newCheckpoint: { timestamp: number };
  newFinalityCheckpoint: { timestamp: number };
  reorg: { commonAncestorTimestamp: number };
};

type EventAggregatorMetrics = {};

export class EventAggregatorService extends Emittery<EventAggregatorEvents> {
  private store: EventStore;
  private logFilters: LogFilter[];
  private networks: Network[];

  // Minimum timestamp at which events are available (across all networks).
  checkpoint: number;
  // Minimum finalized timestamp (across all networks).
  finalityCheckpoint: number;

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
        fromBlock: logFilter.filter.startBlock,
        toBlock: logFilter.filter.endBlock,
      })),
    });

    // Ugly step. We need to associate events with a log filter. There may be duplicates.
    const decodedEvents = events.reduce<LogEvent[]>((acc, event) => {
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
          // TODO: emit a warning here that an event was not decoded.
          // See https://github.com/0xOlias/ponder/issues/187
        }
      });

      return acc;
    }, []);

    return decodedEvents;
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

  handleReorg = ({ timestamp }: { timestamp: number }) => {
    this.emit("reorg", { commonAncestorTimestamp: timestamp });
  };

  private recalculateCheckpoint = () => {
    const checkpoints = Object.values(this.networkCheckpoints).map((n) =>
      n.isHistoricalSyncComplete ? n.realtimeCheckpoint : n.historicalCheckpoint
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
