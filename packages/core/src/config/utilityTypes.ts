import type { Abi, AbiEvent, FormatAbiItem } from "abitype";
import type { ParseAbiItem } from "viem";

export type NonStrictPick<T, K> = {
  [P in Extract<keyof T, K>]: T[P];
};

export type ExtractAbiEvents<
  abi extends Abi,
  events = Extract<abi[number], { type: "event" }>,
> = [events] extends [never] ? AbiEvent : events;

export type ParseAbiEvent<
  abi extends Abi,
  signature extends string,
  ///
  abiEvents extends AbiEvent = ExtractAbiEvents<abi>,
  noOverloadEvent = Extract<abiEvents, { name: signature }>,
  overloadEvent = Extract<abiEvents, ParseAbiItem<`event ${signature}`>>,
> = [noOverloadEvent] extends [never]
  ? [overloadEvent] extends [never]
    ? AbiEvent
    : overloadEvent
  : noOverloadEvent;

export type FormatAbiEvent<
  abi extends Abi,
  event extends AbiEvent,
  ///
  abiEvents extends AbiEvent = ExtractAbiEvents<abi>,
  matchingNameEvents extends AbiEvent = Extract<
    abiEvents,
    { name: event["name"] }
  >,
> = [matchingNameEvents] extends [never]
  ? never
  : [Exclude<matchingNameEvents, event>] extends [never]
    ? event["name"]
    : FormatAbiItem<event> extends `event ${infer signature}`
      ? signature
      : never;

/**
 * Return an union of safe event names that handle event overridding.
 */
export type SafeEventNames<
  abi extends Abi,
  ///
  abiEvents extends AbiEvent = ExtractAbiEvents<abi>,
> = abiEvents extends abiEvents ? FormatAbiEvent<abi, abiEvents> : never;
