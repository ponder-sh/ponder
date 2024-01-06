import type { Abi, AbiEvent, FormatAbiItem } from "abitype";
import type { ParseAbiItem } from "viem";

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
  overloadEvent extends AbiEvent = ParseAbiItem<`event ${signature}`> &
    AbiEvent,
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
 * {@link https://stackoverflow.com/questions/53953814/typescript-check-if-a-type-is-a-union}
 */
type IsUnion<
  T,
  ///
  U extends T = T,
> = T extends unknown ? ([U] extends [T] ? false : true) : false;

/**
 * Return an union of safe event names that handle event overridding.
 */
export type SafeEventNames<
  abi extends Abi,
  ///
  abiEvents extends AbiEvent = ExtractAbiEvents<abi>,
> = FormatAbiEvent<abi, abiEvents>;
