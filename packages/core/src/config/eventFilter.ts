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

export type GetEventFilter<abi extends Abi, filter> = filter extends {
  // 1. Contract has a filter
  event: infer event extends SafeEventNames<FilterAbiEvents<abi>>[number];
}
  ? // ? // 1.a Contract has a filter and a valid event
    //   {
    //     event:
    //       | SafeEventNames<FilterAbiEvents<abi>>[number]
    //       | (event extends SafeEventNames<FilterAbiEvents<abi>>[number]
    //           ? event
    //           : never);
    //     args: event;
    //   }
    // : // 1.b Contract has a filter and an invalid event
    //   {
    //     event: SafeEventNames<FilterAbiEvents<abi>>[number];
    //     a?: abi;
    //     args?: GetEventArgs<Abi | readonly unknown[], string>;
    //   };

    // 1.a Contract has a filter and a valid event
    {
      event: event;
    }
  : // 1.b Contract has a filter and an invalid event
    {
      event: "b";
    };
