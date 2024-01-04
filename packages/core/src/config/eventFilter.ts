import type { AbiEvent } from "abitype";
import type { Abi, GetEventArgs } from "viem";
import type {
  FilterAbiEvents,
  RecoverAbiEvent,
  SafeEventNames,
} from "./utilityTypes.js";

export type DefaultEventFilter =
  | {
      event: string;
      args?: GetEventArgs<Abi | readonly unknown[], string>;
    }
  | {
      event: readonly string[];
      args?: never;
    };

type EventName<abi extends Abi | readonly unknown[]> =
  | Abi
  | readonly unknown[] extends abi
  ? unknown
  :
      | SafeEventNames<FilterAbiEvents<abi & Abi>>[number]
      | readonly SafeEventNames<FilterAbiEvents<abi & Abi>>[number][];

type Args<
  abi extends Abi | readonly unknown[],
  eventName extends EventName<abi>,
> = Abi | readonly unknown[] extends abi
  ? unknown
  : eventName extends readonly string[]
    ? never
    : GetEventArgs<
        abi,
        string,
        {
          EnableUnion: true;
          IndexedOnly: true;
          Required: false;
        },
        RecoverAbiEvent<
          FilterAbiEvents<abi extends Abi ? abi : Abi>,
          eventName & string
        > extends infer abiEvent extends AbiEvent
          ? abiEvent
          : AbiEvent
      >;

export type EventFilter<
  abi extends Abi | readonly unknown[] = Abi,
  eventName extends EventName<abi> = EventName<abi>,
  args extends Args<abi, eventName> = Args<abi, eventName>,
> = Abi extends abi
  ? DefaultEventFilter
  : readonly unknown[] extends abi
    ? DefaultEventFilter
    : eventName extends readonly string[]
      ? {
          event: eventName;
          args?: never;
        }
      : eventName extends string
        ? {
            event: eventName;
            args: args;
          }
        : never;
