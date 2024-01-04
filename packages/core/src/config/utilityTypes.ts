import type { Abi, AbiEvent, FormatAbiItem } from "abitype";

/**
 * Filter out only the Abi events from the Abi.
 */
export type FilterAbiEvents<abi extends Abi> = abi extends readonly [
  infer first,
  ...infer rest extends Abi,
]
  ? first extends AbiEvent
    ? readonly [first, ...FilterAbiEvents<rest>]
    : FilterAbiEvents<rest>
  : [];

/**
 * Remove element from arr.
 */
type FilterElement<
  element,
  arr extends readonly unknown[],
> = arr extends readonly [infer first, ...infer rest]
  ? element extends first
    ? FilterElement<element, rest>
    : readonly [first, ...FilterElement<element, rest>]
  : [];

/**
 * Return an union of safe event names that handle event overridding.
 */
export type SafeEventNames<
  abi extends readonly AbiEvent[],
  arr extends readonly AbiEvent[] = abi,
> = abi extends readonly [
  infer First extends AbiEvent,
  ...infer Rest extends readonly AbiEvent[],
]
  ? First["name"] extends FilterElement<First, arr>[number]["name"]
    ? // Overriding occurs, use full name
      FormatAbiItem<First> extends `event ${infer LongEvent extends string}`
      ? readonly [LongEvent, ...SafeEventNames<Rest, arr>]
      : never
    : // Short name
      readonly [First["name"], ...SafeEventNames<Rest, arr>]
  : [];

/**
 * Recover the element from {@link abi} at the index where {@link safeName} is equal to {@link safeNames}[index].
 */
export type RecoverAbiEvent<
  abi extends readonly AbiEvent[],
  safeName extends string,
  safeNames extends SafeEventNames<abi> = SafeEventNames<abi>,
> = abi extends readonly [
  infer firstAbi,
  ...infer restAbi extends readonly AbiEvent[],
]
  ? safeNames extends readonly [
      infer firstName,
      ...infer restName extends SafeEventNames<restAbi>,
    ]
    ? firstName extends safeName
      ? firstAbi
      : RecoverAbiEvent<restAbi, safeName, restName>
    : never
  : never;
