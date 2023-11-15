import type { Hex } from "viem";

import type { LogEventMetadata } from "@/config/abi.js";
import type { Source } from "@/config/sources.js";
import type { Block } from "@/types/block.js";
import type { Log } from "@/types/log.js";
import type { Transaction } from "@/types/transaction.js";

export interface LogEvent {
  name: string;
  args: Record<string, any>;
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

export type IndexingFunctions = {
  _meta_: {
    setup?: {
      fn: SetupEventIndexingFunction;
    };
  };
  eventSources: {
    [key: EventSourceName]: {
      // This mapping is passed from the IndexingService to the SyncGatewayService, which uses
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
    },
  );

  return indexingFunctions;
};
