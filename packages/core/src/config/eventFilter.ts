import type { Abi, GetEventArgs } from "viem";
import type { ParseAbiEvent, SafeEventNames } from "./utilityTypes.js";

type FilterArgs<abi extends Abi, event extends string> = GetEventArgs<
  abi,
  string,
  {
    EnableUnion: true;
    IndexedOnly: true;
    Required: false;
  },
  ParseAbiEvent<abi, event>
>;

export type GetEventFilter<
  abi extends Abi,
  ///
  safeEventNames extends string = SafeEventNames<abi>,
> = {
  filter?:
    | (safeEventNames extends safeEventNames
        ? {
            event: safeEventNames;
            args: FilterArgs<abi, safeEventNames>;
          }
        : never)
    | (safeEventNames extends safeEventNames
        ? {
            event: safeEventNames;
            args: FilterArgs<abi, safeEventNames>;
          }
        : never)[];
};
