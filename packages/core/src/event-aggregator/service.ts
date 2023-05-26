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

/**
 * This service listens to the following events:
 *
 * Historical sync service (N copies):
 * - newEvents
 *
 * Realtime sync service (N copies):
 * - newEvents
 * - finalityCheckpoint(newFinalityCheckpoint)
 * - reorg(commonAncestorBlock)
 *
 * How does it respond to newEvents?????
 * Ok it needs some internal state for each network/service:
 * - eventsAvailableFromTimestamp
 * - eventsAvailableToTimestamp
 *
 *
 * Ok so basically at the moment, the event handler service gets barraged with `newEvents`
 * events from the frontfill/backfill services. It handles them with a mutex (smart!).
 *
 * It maintains eventsProcessedToTimestamp. When it handles `newEvents`, it checks if there are
 * new events to process by querying the cache store for a bunch of shit. This should be handled by a separate service
 * that only talks to the event store. The event handler service should "build" the user handlers in a different file,
 * and the service is really only responsible for:
 * - Maintaining eventsProcessedToTimestamp
 * - Listening to newEvents from aggregator service
 * - Fetching new events from aggregator service and running them
 * - Listening to finality checkpoint / reorg events from aggregator service
 * - Handling all user store operations required for those.
 *
 * So, the aggregator service should only send newEvents when it's internal
 * eventsAvailableToTimestamp moves forward. It ALSO needs to maintain an earliestFinalityTimestamp
 * that is aggregated across all event sources.
 *
 * EventAggregatorService events:
 * - eventsAvailable(toTimestamp)
 * - finalityCheckpoint(safeTimestamp)
 * - reorg(commonAncestorTimestamp)
 *
 * So in its newEvents handler, it moves forward the internal eventsAvailableTimestamp FOR THAT NETWORK,
 * then checks the minimum across all networks and IF it's greater than the curent overallCheckpoint,
 * it emits eventsAvailable(overallCheckpoint)
 *  -> That's how it should work for historical events.
 *
 * If the historical sync is known to be complete, it works the same way BUT calculates the overallCheckpoint
 * based on the MAXIMUM timestamp of all networks. Hmm. This is tricky though.
 *
 * There's an edge case in realtime - consider two networks, one at 100 one at 110. We emitted an event for the network at 110, which
 * had an event at 108. The event handler service fetched those events and processed them. Then, the network at 100 emits an event at 105.
 * We already processed the event from the other network at 108, so if we process the 105 now, events have been processed out of order.
 *
 * Maybe the workaround is that every realtime service will submit an event on every poll... and then we could continue to use the
 * minimum timestamp across all networks as the toTimestamp. That would kinda slow down event processing to the speed of the
 * slowest polling network.
 *
 * Ok, what's the simple and dumb version of this? When we add a new block to the realtime chain, emit an event newBlock(timestamp).
 *
 *
 */
