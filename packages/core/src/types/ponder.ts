import type { Config } from "@/config/config.js";
import type { ParseAbiEvent, SafeEventNames } from "@/config/utilityTypes.js";
import type { ReadOnlyClient } from "@/indexing/ponderActions.js";
import type { Infer, Schema } from "@/schema/types.js";
import type { Block } from "@/types/block.js";
import type { Log } from "@/types/log.js";
import type { DatabaseModel } from "@/types/model.js";
import type { Transaction } from "@/types/transaction.js";
import type { Abi, GetEventArgs } from "viem";
import type { Prettify } from "./utils.js";

type Setup = "setup";

type _FormatEventNames<
  contract extends Config["contracts"][string],
  ///
  safeEventNames = SafeEventNames<contract["abi"]>,
> = string extends safeEventNames
  ? never
  : contract extends {
        filter: { event: infer event extends string | readonly string[] };
      }
    ? event extends safeEventNames
      ? event
      : event[number] extends safeEventNames
        ? event[number]
        : safeEventNames
    : safeEventNames;

/** "{ContractName}:{EventName}". */
export type FormatEventNames<contracts extends Config["contracts"]> = {
  [name in keyof contracts]: `${name & string}:${
    | _FormatEventNames<contracts[name]>
    | Setup}`;
}[keyof contracts];

export type ExtractEventName<name extends string> =
  name extends `${string}:${infer EventName extends string}`
    ? EventName
    : never;

export type ExtractContractName<name extends string> =
  name extends `${infer ContractName extends string}:${string}`
    ? ContractName
    : never;

export type PonderEventNames<config extends Config> = FormatEventNames<
  config["contracts"]
>;

export type PonderEvent<
  config extends Config,
  contractName extends keyof config["contracts"],
  eventName extends string,
> = eventName extends Setup
  ? never
  : {
      name: eventName;
      args: GetEventArgs<
        Abi,
        string,
        {
          EnableUnion: false;
          IndexedOnly: false;
          Required: true;
        },
        ParseAbiEvent<config["contracts"][contractName]["abi"], eventName>
      >;
      log: Log;
      block: Block;
      transaction: Transaction;
    };

type ContextContractProperty = Exclude<
  keyof Config["contracts"][string],
  "abi" | "network" | "filter" | "factory"
>;

type ExtractOverridenProperty<
  contract extends Config["contracts"][string],
  property extends ContextContractProperty,
  ///
  base = Extract<contract, { [p in property]: unknown }>[property],
  override = Extract<
    contract["network"][keyof contract["network"]],
    { [p in property]: unknown }
  >[property],
> = ([base] extends [never] ? undefined : base) | override;

export type PonderContext<
  config extends Config,
  schema extends Schema,
  contractName extends keyof config["contracts"],
> = {
  contracts: {
    [_contractName in keyof config["contracts"]]: {
      abi: config["contracts"][_contractName]["abi"];
      address: ExtractOverridenProperty<
        config["contracts"][_contractName],
        "address"
      >;
      startBlock: ExtractOverridenProperty<
        config["contracts"][_contractName],
        "startBlock"
      >;
      endBlock: ExtractOverridenProperty<
        config["contracts"][_contractName],
        "endBlock"
      >;
    };
  };
  network: config["contracts"][contractName]["network"] extends string
    ? // 1. No network overriding
      {
        name: config["contracts"][contractName]["network"];
        chainId: config["networks"][config["contracts"][contractName]["network"]]["chainId"];
      }
    : // 2. Network overrides
      {
        [key in keyof config["contracts"][contractName]["network"]]: {
          name: key;
          chainId: config["networks"][key &
            keyof config["networks"]]["chainId"];
        };
      }[keyof config["contracts"][contractName]["network"]];
  client: Prettify<
    Omit<
      ReadOnlyClient,
      | "extend"
      | "key"
      | "batch"
      | "cacheTime"
      | "account"
      | "type"
      | "uid"
      | "chain"
      | "name"
      | "pollingInterval"
      | "transport"
    >
  >;
  db: {
    [key in keyof Infer<schema>]: DatabaseModel<Infer<schema>[key]>;
  };
};

export type PonderApp<config extends Config, schema extends Schema> = {
  on: <
    name extends PonderEventNames<config>,
    ///
    contractName extends ExtractContractName<name> = ExtractContractName<name>,
    eventName extends ExtractEventName<name> = ExtractEventName<name>,
  >(
    _name: name,
    indexingFunction: (
      args: { event: PonderEvent<config, contractName, eventName> } & {
        context: PonderContext<config, schema, contractName>;
      },
    ) => Promise<void> | void,
  ) => void;
};
