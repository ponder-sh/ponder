import Emittery from "emittery";
import { type Hex, decodeEventLog } from "viem";

import type { LogFilterName } from "@/build/handlers";
import type { LogEventMetadata, LogFilter } from "@/config/logFilters";
import type { Network } from "@/config/network";
import type { EventStore } from "@/event-store/store";
import type { Common } from "@/Ponder";
import type { Block } from "@/types/block";
import type { Log } from "@/types/log";
import type { Transaction } from "@/types/transaction";
import { formatShortDate } from "@/utils/date";

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
   * Emitted when a new event checkpoint is reached. This is the minimum
   * block number at which events are available.
   */
  newCheckpoint: { blockNumber: number };
  /**
   * Emitted when a new finality checkpoint is reached. This is the minimum
   * block number at which events are finalized.
   */
  newFinalityCheckpoint: { blockNumber: number };
  /**
   * Emitted when a reorg has been detected.
   */
  reorg: { commonAncestorBlockNumber: number };
};

export class EventAggregatorService extends Emittery<EventAggregatorEvents> {
  private common: Common;
  private eventStore: EventStore;
  private network: Network;
  private logFilters: LogFilter[];

  // Minimum block number at which events are available from the historical sync.
  private historicalCheckpoint: number;
  // Minimum block number at which events are available from the realtime sync.
  private realtimeCheckpoint: number;

  // Minimum block number at which events are available, combining historical and realtime.
  checkpoint: number;
  // Minimum finalized block number.
  finalityCheckpoint: number;

  // True if the historical sync is complete. Once true, ignore historicalCheckpoint.
  isHistoricalSyncComplete: boolean;
  // The final block number of the historical sync. Only set once isHistoricalSyncComplete is true.
  historicalSyncFinalBlockNumber?: number;

  constructor({
    common,
    eventStore,
    network,
    logFilters,
  }: {
    common: Common;
    eventStore: EventStore;
    network: Network;
    logFilters: LogFilter[];
  }) {
    super();

    this.common = common;
    this.eventStore = eventStore;
    this.logFilters = logFilters;
    this.network = network;

    this.historicalCheckpoint = 0;
    this.isHistoricalSyncComplete = false;
    this.realtimeCheckpoint = 0;

    this.checkpoint = 0;
    this.finalityCheckpoint = 0;
  }

  /** Fetches events for all registered log filters between the specified timestamps.
   *
   * @param options.fromBlockNumber Block number to start including events (inclusive).
   * @param options.toBlockNumber Block number to stop including events (inclusive).
   * @param options.includeLogFilterEvents Map of log filter name -> selector -> ABI event item for which to include full event objects.
   * @returns A promise resolving to an array of log events.
   */
  async *getEvents({
    fromBlockNumber,
    toBlockNumber,
    includeLogFilterEvents,
  }: {
    fromBlockNumber: number;
    toBlockNumber: number;
    includeLogFilterEvents: {
      [logFilterName: LogFilterName]:
        | {
            bySelector: { [selector: Hex]: LogEventMetadata };
          }
        | undefined;
    };
  }) {
    const iterator = this.eventStore.getLogEvents({
      chainId: this.network.chainId,
      fromBlockNumber,
      toBlockNumber,
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
      const { events, counts, pageEndsAtBlockNumber } = page;

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

      yield { events: decodedEvents, counts, pageEndsAtBlockNumber };
    }
  }

  handleNewHistoricalCheckpoint = ({
    blockNumber,
  }: {
    blockNumber: number;
  }) => {
    this.historicalCheckpoint = blockNumber;

    this.common.logger.trace({
      service: "aggregator",
      msg: `New historical checkpoint at ${blockNumber}`,
    });

    this.recalculateCheckpoint();
  };

  handleHistoricalSyncComplete = ({ blockNumber }: { blockNumber: number }) => {
    this.historicalCheckpoint = blockNumber;
    this.isHistoricalSyncComplete = true;
    this.recalculateCheckpoint();

    this.historicalSyncFinalBlockNumber = blockNumber;

    this.common.logger.debug({
      service: "aggregator",
      msg: `Completed historical sync`,
    });
  };

  handleNewRealtimeCheckpoint = ({ blockNumber }: { blockNumber: number }) => {
    this.realtimeCheckpoint = blockNumber;

    this.common.logger.trace({
      service: "aggregator",
      msg: `New realtime checkpoint at ${blockNumber}`,
    });

    this.recalculateCheckpoint();
  };

  handleNewFinalityCheckpoint = ({ blockNumber }: { blockNumber: number }) => {
    this.finalityCheckpoint = blockNumber;

    this.emit("newFinalityCheckpoint", {
      blockNumber: this.finalityCheckpoint,
    });

    this.common.logger.trace({
      service: "aggregator",
      msg: `New finality checkpoint at ${this.finalityCheckpoint}`,
    });
  };

  handleReorg = ({
    commonAncestorBlockNumber,
  }: {
    commonAncestorBlockNumber: number;
  }) => {
    this.emit("reorg", { commonAncestorBlockNumber });
  };

  private recalculateCheckpoint = () => {
    const newCheckpoint = this.isHistoricalSyncComplete
      ? Math.max(this.historicalCheckpoint, this.realtimeCheckpoint)
      : this.historicalCheckpoint;

    if (newCheckpoint > this.checkpoint) {
      this.checkpoint = newCheckpoint;

      this.common.logger.trace({
        service: "aggregator",
        msg: `New event checkpoint at ${this.checkpoint} [${formatShortDate(
          this.checkpoint
        )}]`,
      });

      this.emit("newCheckpoint", { blockNumber: this.checkpoint });
    }
  };
}
