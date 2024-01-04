import type { Abi, GetEventArgs } from "viem";
import type { FilterAbiEvents, SafeEventNames } from "./utilityTypes.js";

export type DefaultEventFilter =
  | {
      event: string;
      args?: GetEventArgs<Abi | readonly unknown[], string>;
    }
  | {
      event: readonly string[];
      args?: never;
    };

type EventName<abi extends Abi | readonly unknown[]> = Abi extends abi
  ? string | readonly string[]
  : readonly unknown[] extends abi
    ? string | readonly string[]
    :
        | SafeEventNames<FilterAbiEvents<abi & Abi>>
        | readonly SafeEventNames<FilterAbiEvents<abi & Abi>>[];

// type Args<abi extends Abi | readonly unknown[]> = Abi extends abi
// ?

export type EventFilter<
  abi extends Abi | readonly unknown[] = Abi,
  eventName extends EventName<abi> = EventName<abi>,
  args extends eventName extends readonly string[]
    ? never
    : "hi" = eventName extends readonly string[] ? never : "hi",
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
