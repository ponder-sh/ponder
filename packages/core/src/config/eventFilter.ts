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

// 获取事件的所有参数（包括非索引参数），用于condition函数
type EventArgs<abi extends Abi, event extends string> = GetEventArgs<
  abi,
  string,
  {
    EnableUnion: false;
    IndexedOnly: false;
    Required: false;
  },
  ParseAbiEvent<abi, event>
>;

// condition函数类型定义
type ConditionFunction<abi extends Abi, event extends string> = (
  args: EventArgs<abi, event>,
) => boolean | Promise<boolean>;

export type GetEventFilter<
  abi extends Abi,
  ///
  safeEventNames extends string = SafeEventNames<abi>,
> = {
  filter?:
    | (safeEventNames extends safeEventNames
        ? {
            event: safeEventNames;
            args?: FilterArgs<abi, safeEventNames>;
            condition?: ConditionFunction<abi, safeEventNames>;
          }
        : never)
    | (safeEventNames extends safeEventNames
        ? {
            event: safeEventNames;
            args?: FilterArgs<abi, safeEventNames>;
            condition?: ConditionFunction<abi, safeEventNames>;
          }
        : never)[];
};
