import { Abi, GetEventArgs } from "viem";

import {
  FilterEvents,
  RecoverAbiEvent,
  ResolvedConfig,
  SafeEventNames,
} from "@/config/config";
import { Block } from "@/types/block";
import { Log } from "@/types/log";
import { Transaction } from "@/types/transaction";

export type Name<TContract extends ResolvedConfig["contracts"][number]> =
  `${TContract["name"]}:${SafeEventNames<
    FilterEvents<TContract["abi"]>,
    FilterEvents<TContract["abi"]>
  >[number]}`;

export type Names<TContracts extends ResolvedConfig["contracts"]> =
  TContracts extends readonly [
    infer First extends ResolvedConfig["contracts"][number],
    ...infer Rest extends ResolvedConfig["contracts"]
  ]
    ? [Name<First>, ...Names<Rest>]
    : [];

type RecoverContract<
  TContracts extends ResolvedConfig["contracts"],
  TName extends string
> = TContracts extends readonly [
  infer First extends ResolvedConfig["contracts"][number],
  ...infer Rest extends ResolvedConfig["contracts"]
]
  ? First["name"] extends TName
    ? First
    : RecoverContract<Rest, TName>
  : never;

export type PonderApp<TConfig extends ResolvedConfig> = {
  on: <TName extends Names<TConfig["contracts"]>[number]>(
    name: TName,
    indexingFunction: ({
      event,
      context,
    }: {
      event: {
        name: TName extends `${string}:${infer EventName}` ? EventName : string;
        params: GetEventArgs<
          Abi,
          string,
          {
            EnableUnion: false;
            IndexedOnly: false;
            Required: true;
          },
          TName extends `${infer ContractName}:${infer EventName}`
            ? RecoverAbiEvent<
                RecoverContract<TConfig["contracts"], ContractName> extends {
                  abi: infer _abi extends Abi;
                }
                  ? FilterEvents<_abi>
                  : never,
                EventName
              >
            : never
        >;
        log: Log;
        block: Block;
        transaction: Transaction;
      };
      context: any;
    }) => Promise<void> | void
  ) => void;
};
