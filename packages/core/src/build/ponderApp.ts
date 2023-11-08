import { AbiEvent } from "abitype";
import { Abi, GetEventArgs } from "viem";

import {
  Config,
  ContractFilter,
  ContractRequired,
  FilterAbiEvents,
  RecoverAbiEvent,
  SafeEventNames,
} from "@/config/config";
import { ReadOnlyClient } from "@/indexing/ponderActions";
import { Block } from "@/types/block";
import { Log } from "@/types/log";
import { Transaction } from "@/types/transaction";

/** "{ContractName}:{EventName}". */
export type Name<TContract extends Config["contracts"][number]> =
  `${TContract["name"]}:${SafeEventNames<
    FilterAbiEvents<TContract["abi"]>
  >[number]}`;

/** All possible names for a list of contracts. */
export type Names<TContracts extends Config["contracts"]> =
  TContracts extends readonly [
    infer First extends Config["contracts"][number],
    ...infer Rest extends Config["contracts"]
  ]
    ? [Name<First>, ...Names<Rest>]
    : [];

/** Recover the `contract` element at the index where {@link TName} is equal to {@link TContracts}[index]. */
export type RecoverContract<
  TContracts extends Config["contracts"],
  TName extends string
> = TContracts extends readonly [
  infer First extends Config["contracts"][number],
  ...infer Rest extends Config["contracts"]
]
  ? First["name"] extends TName
    ? First
    : RecoverContract<Rest, TName>
  : never;

type ContractNetworkOverrides = ContractRequired<
  string,
  readonly AbiEvent[],
  string
>["network"];

/** Extract the address type from a Contract. */
export type ExtractAddress<
  TContract extends
    | ContractNetworkOverrides
    | ContractFilter<readonly AbiEvent[], string>
> = Extract<TContract, { address: unknown }>["address"];

/** Extract the startBlock type from a Contract. */
export type ExtractStartBlock<
  TContract extends
    | ContractNetworkOverrides
    | ContractFilter<readonly AbiEvent[], string>
> = Extract<TContract, { startBlock: unknown }>["startBlock"];

/** Extract the endBlock type from a Contract. */
export type ExtractEndBlock<
  TContract extends
    | ContractNetworkOverrides
    | ContractFilter<readonly AbiEvent[], string>
> = Extract<TContract, { endBlock: unknown }>["endBlock"];

/** Extract all address from a list of Contracts. */
export type ExtractAllAddresses<TContracts extends ContractNetworkOverrides> =
  TContracts extends readonly [
    infer First extends ContractNetworkOverrides[number],
    ...infer Rest extends ContractNetworkOverrides
  ]
    ? readonly [ExtractAddress<First>, ...ExtractAllAddresses<Rest>]
    : [];

/** Extract all startBlocks from a list of Contracts. */
export type ExtractAllStartBlocks<TContracts extends ContractNetworkOverrides> =
  TContracts extends readonly [
    infer First extends ContractNetworkOverrides[number],
    ...infer Rest extends ContractNetworkOverrides
  ]
    ? readonly [ExtractStartBlock<First>, ...ExtractAllStartBlocks<Rest>]
    : [];

/** Extract all endBlocks from a list of Contracts. */
export type ExtractAllEndBlocks<TContracts extends ContractNetworkOverrides> =
  TContracts extends readonly [
    infer First extends ContractNetworkOverrides[number],
    ...infer Rest extends ContractNetworkOverrides
  ]
    ? readonly [ExtractEndBlock<First>, ...ExtractAllEndBlocks<Rest>]
    : [];

/** Transform Contracts into the appropriate type for PonderApp. */
type AppContracts<TContracts extends Config["contracts"]> =
  TContracts extends readonly [
    infer First extends Config["contracts"][number],
    ...infer Rest extends Config["contracts"]
  ]
    ? Record<
        First["name"],
        {
          abi: First["abi"];
          address:
            | ExtractAddress<First>
            | ExtractAllAddresses<First["network"]>[number];
          startBlock:
            | ExtractStartBlock<First>
            | ExtractAllStartBlocks<First["network"]>[number];
          endBlock:
            | ExtractEndBlock<First>
            | ExtractAllEndBlocks<First["network"]>[number];
        }
      > &
        AppContracts<Rest>
    : {};

export type PonderApp<TConfig extends Config> = {
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
                  ? FilterAbiEvents<_abi>
                  : never,
                EventName
              >
            : never
        >;
        log: Log;
        block: Block;
        transaction: Transaction;
      };
      context: {
        contracts: AppContracts<TConfig["contracts"]>;
        network: {
          chainId: number;
          name: TName extends `${infer ContractName}:${string}`
            ? RecoverContract<
                TConfig["contracts"],
                ContractName
              >["network"][number]["name"]
            : never;
        };
        client: ReadOnlyClient;
        models: any; // use ts-schema to infer types
      };
    }) => Promise<void> | void
  ) => void;
};
