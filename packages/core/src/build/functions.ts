import type { Hex } from "viem";

import type { LogEventMetadata } from "@/config/abi";
import { Source } from "@/config/sources";
import type { Block } from "@/types/block";
import type { Log } from "@/types/log";
import type { Transaction } from "@/types/transaction";

export interface LogEvent {
  name: string;
  params: Record<string, any>;
  log: Log;
  block: Block;
  transaction: Transaction;
}

type EventSourceName = string;
type EventName = string;

type LogEventIndexingFunction = ({
  event,
  context,
}: {
  event: LogEvent;
  context: unknown;
}) => Promise<void> | void;

type SetupEventIndexingFunction = ({
  context,
}: {
  context: unknown;
}) => Promise<void> | void;

export type RawIndexingFunctions = {
  _meta_?: {
    setup?: SetupEventIndexingFunction;
  };
  eventSources: {
    [key: EventSourceName]: {
      [key: EventName]: LogEventIndexingFunction;
    };
  };
};

// @ponder/core creates an instance of this class called `ponder`
export class PonderApp<
  IndexingFunctions = Record<string, LogEventIndexingFunction>
> {
  private indexingFunctions: RawIndexingFunctions = { eventSources: {} };
  private errors: Error[] = [];

  on<EventName extends Extract<keyof IndexingFunctions, string>>(
    name: EventName,
    indexingFunction: IndexingFunctions[EventName]
  ) {
    if (name === "setup") {
      this.indexingFunctions._meta_ ||= {};
      this.indexingFunctions._meta_.setup =
        indexingFunction as SetupEventIndexingFunction;
      return;
    }

    const [eventSourceName, eventName] = name.split(":");
    if (!eventSourceName || !eventName) {
      this.errors.push(new Error(`Invalid event name: ${name}`));
      return;
    }

    this.indexingFunctions.eventSources[eventSourceName] ||= {};
    if (this.indexingFunctions.eventSources[eventSourceName][eventName]) {
      this.errors.push(
        new Error(`Cannot add multiple indexing functions for event: ${name}`)
      );
      return;
    }
    this.indexingFunctions.eventSources[eventSourceName][eventName] =
      indexingFunction as LogEventIndexingFunction;
  }
}

export type IndexingFunctions = {
  _meta_: {
    setup?: {
      fn: SetupEventIndexingFunction;
    };
  };
  eventSources: {
    [key: EventSourceName]: {
      // This mapping is passed from the IndexingService to the EventAggregatorService, which uses
      // it to fetch from the store _only_ the events that the user has indexed.
      bySelector: { [key: Hex]: LogEventMetadata };
      // This mapping is used by the IndexingService to fetch the user-provided `fn` before running it.
      bySafeName: {
        [key: EventName]: LogEventMetadata & { fn: LogEventIndexingFunction };
      };
    };
  };
};

export const hydrateIndexingFunctions = ({
  rawIndexingFunctions,
  sources,
}: {
  rawIndexingFunctions: RawIndexingFunctions;
  sources: Source[];
}) => {
  const indexingFunctions: IndexingFunctions = {
    _meta_: {},
    eventSources: {},
  };

  if (rawIndexingFunctions._meta_?.setup) {
    indexingFunctions._meta_.setup = { fn: rawIndexingFunctions._meta_.setup };
  }

  Object.entries(rawIndexingFunctions.eventSources).forEach(
    ([eventSourceName, eventSourceFunctions]) => {
      const source = sources.find((source) => source.name === eventSourceName);

      if (!source) {
        throw new Error(`Event source not found in config: ${eventSourceName}`);
      }

      Object.entries(eventSourceFunctions).forEach(([eventName, fn]) => {
        const eventData = source.events[eventName];

        if (!eventData) {
          throw new Error(`Log event not found in ABI: ${eventName}`);
        }

        indexingFunctions.eventSources[eventSourceName] ||= {
          bySafeName: {},
          bySelector: {},
        };
        indexingFunctions.eventSources[eventSourceName].bySelector[
          eventData.selector
        ] = eventData;
        indexingFunctions.eventSources[eventSourceName].bySafeName[
          eventData.safeName
        ] = { ...eventData, fn: fn };
      });
    }
  );

  return indexingFunctions;
};
