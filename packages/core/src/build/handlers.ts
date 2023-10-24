import type { Hex } from "viem";

import type { LogEventMetadata } from "@/config/abi";
import type { Factory } from "@/config/factories";
import type { LogFilter } from "@/config/logFilters";
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

type LogEventHandlerFunction = ({
  event,
  context,
}: {
  event: LogEvent;
  context: unknown;
}) => Promise<void> | void;

type SetupEventHandlerFunction = ({
  context,
}: {
  context: unknown;
}) => Promise<void> | void;

export type RawHandlerFunctions = {
  _meta_?: {
    setup?: SetupEventHandlerFunction;
  };
  eventSources: {
    [key: EventSourceName]: {
      [key: EventName]: LogEventHandlerFunction;
    };
  };
};

// @ponder/core creates an instance of this class called `ponder`
export class PonderApp<
  EventHandlers = Record<string, LogEventHandlerFunction>
> {
  private handlerFunctions: RawHandlerFunctions = { eventSources: {} };
  private errors: Error[] = [];

  on<EventName extends Extract<keyof EventHandlers, string>>(
    name: EventName,
    handler: EventHandlers[EventName]
  ) {
    if (name === "setup") {
      this.handlerFunctions._meta_ ||= {};
      this.handlerFunctions._meta_.setup = handler as SetupEventHandlerFunction;
      return;
    }

    const [eventSourceName, eventName] = name.split(":");
    if (!eventSourceName || !eventName) {
      this.errors.push(new Error(`Invalid event name: ${name}`));
      return;
    }

    this.handlerFunctions.eventSources[eventSourceName] ||= {};
    if (this.handlerFunctions.eventSources[eventSourceName][eventName]) {
      this.errors.push(
        new Error(`Cannot add multiple handler functions for event: ${name}`)
      );
      return;
    }
    this.handlerFunctions.eventSources[eventSourceName][eventName] =
      handler as LogEventHandlerFunction;
  }
}

export type HandlerFunctions = {
  _meta_: {
    setup?: {
      fn: SetupEventHandlerFunction;
    };
  };
  eventSources: {
    [key: EventSourceName]: {
      // This mapping is passed from the EventHandlerService to the EventAggregatorService, which uses
      // it to fetch from the store _only_ the events that the user has handled.
      bySelector: { [key: Hex]: LogEventMetadata };
      // This mapping is used by the EventHandlerService to fetch the user-provided `fn` before running it.
      bySafeName: {
        [key: EventName]: LogEventMetadata & { fn: LogEventHandlerFunction };
      };
    };
  };
};

export const hydrateHandlerFunctions = ({
  rawHandlerFunctions,
  logFilters,
  factories,
}: {
  rawHandlerFunctions: RawHandlerFunctions;
  logFilters: LogFilter[];
  factories: Factory[];
}) => {
  const handlerFunctions: HandlerFunctions = {
    _meta_: {},
    eventSources: {},
  };

  if (rawHandlerFunctions._meta_?.setup) {
    handlerFunctions._meta_.setup = { fn: rawHandlerFunctions._meta_.setup };
  }

  Object.entries(rawHandlerFunctions.eventSources).forEach(
    ([eventSourceName, eventSourceFunctions]) => {
      const logFilter = logFilters.find((l) => l.name === eventSourceName);
      const factory = factories.find((f) => f.name === eventSourceName);

      if (!logFilter && !factory) {
        throw new Error(`Event source not found in config: ${eventSourceName}`);
      }

      Object.entries(eventSourceFunctions).forEach(([eventName, fn]) => {
        const eventData = logFilter
          ? logFilter.events[eventName]
          : factory?.events[eventName];

        if (!eventData) {
          throw new Error(`Log event not found in ABI: ${eventName}`);
        }

        handlerFunctions.eventSources[eventSourceName] ||= {
          bySafeName: {},
          bySelector: {},
        };
        handlerFunctions.eventSources[eventSourceName].bySelector[
          eventData.selector
        ] = eventData;
        handlerFunctions.eventSources[eventSourceName].bySafeName[
          eventData.safeName
        ] = { ...eventData, fn: fn };
      });
    }
  );

  return handlerFunctions;
};
