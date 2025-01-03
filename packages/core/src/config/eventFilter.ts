import type { Abi, GetEventArgs } from "viem";
import type { ParseAbiEvent, SafeEventNames } from "./utilityTypes.js";

// TODO: Fix this type ( changes: args are required, event is singular for each filter )
// Filters are only for topic1/2/3 filtering
export type GetEventFilter<
  abi extends Abi,
  contract,
  ///
  safeEventNames extends string = SafeEventNames<abi>,
> = contract extends {
  filter: {
    event: infer event extends string;
  };
}
  ? event extends safeEventNames
    ? // 1.b.i Filter event is a valid string
      {
        filter?: {
          event: safeEventNames | event;
          args: GetEventArgs<
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
          args: GetEventArgs<Abi | readonly unknown[], string>;
        };
      }
  : {
      filter?:
        | {
            event: safeEventNames;
            args: GetEventArgs<Abi | readonly unknown[], string>;
          }[]
        | {
            event: safeEventNames;
            args: GetEventArgs<Abi | readonly unknown[], string>;
          };
    };
