import type { Abi, GetEventArgs } from "viem";
import type { ParseAbiEvent, SafeEventNames } from "./utilityTypes.js";

export type GetEventFilter<
  abi extends Abi,
  contract,
  ///
  safeEventNames extends string = SafeEventNames<abi>,
> = contract extends {
  filter: {
    event: infer event extends readonly string[] | string;
  };
}
  ? // 1. Contract has a filter with event
    event extends readonly string[]
    ? // 1.a Filter event is an array
      {
        filter?: {
          event: readonly safeEventNames[];
        };
      }
    : // 1.b Filter event is a string
      event extends safeEventNames
      ? // 1.b.i Filter event is a valid string
        {
          filter?: {
            event: safeEventNames | event;
            args?: GetEventArgs<
              abi,
              string,
              {
                EnableUnion: true;
                IndexedOnly: true;
                Required: false;
              },
              ParseAbiEvent<abi, event>
            >;
          };
        }
      : // 1.b.ii Filter event is an invalid string
        {
          filter?: {
            event: safeEventNames;
            args?: GetEventArgs<Abi | readonly unknown[], string>;
          };
        }
  : // 2. Contract doesn't have a filter with event
    {
      filter?: {
        event: safeEventNames | readonly safeEventNames[];
        args?: GetEventArgs<Abi | readonly unknown[], string>;
      };
    };
