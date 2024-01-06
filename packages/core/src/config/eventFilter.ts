import type { Abi, GetEventArgs } from "viem";
import type { ParseAbiEvent, SafeEventNames } from "./utilityTypes.js";

export type GetEventFilter<
  abi extends Abi,
  contract,
  ///
  safeEventNames extends string = SafeEventNames<abi>,
> = contract extends {
  filter: {
    // 1. Contract has a filter
    event: infer event extends safeEventNames;
  };
}
  ? // 1.a Contract has a filter and a valid event
    {
      filter: {
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
  : // 1.b Contract has a filter and an invalid event
    {
      filter: {
        event: safeEventNames;
        args?: GetEventArgs<Abi | readonly unknown[], string>;
      };
    };
