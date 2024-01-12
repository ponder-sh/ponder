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

/** "{ContractName}:{EventName}". */
export type FormatEventNames<contracts extends Config["contracts"]> = {
  [name in keyof contracts]: `${name & string}:${
    // 1. Contract has a filter
      | (contracts[name] extends {
          filter: { event: infer event extends string | readonly string[] };
        }
          ? event extends SafeEventNames<contracts[name]["abi"]>
            ? event
            : event[number] extends SafeEventNames<contracts[name]["abi"]>
              ? event[number]
              : SafeEventNames<contracts[name]["abi"]>
          : // 2. Contract doesn't have a filter
            SafeEventNames<contracts[name]["abi"]>)
      | Setup
  }`;
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

export type PonderContext<
  config extends Config,
  schema extends Schema,
  contractName extends keyof config["contracts"],
> = {
  contracts: {
    [_contractName in keyof config["contracts"]]: {
      abi: config["contracts"][_contractName]["abi"];
      address:
        | Extract<
            config["contracts"][_contractName],
            { address: unknown }
          >["address"]
        | Extract<
            config["contracts"][_contractName]["network"][keyof config["contracts"][_contractName]["network"]],
            { address: unknown }
          >["address"];
      startBlock:
        | Extract<
            config["contracts"][_contractName],
            { startBlock: unknown }
          >["startBlock"]
        | Extract<
            config["contracts"][_contractName]["network"][keyof config["contracts"][_contractName]["network"]],
            { startBlock: unknown }
          >["startBlock"];
      endBlock:
        | Extract<
            config["contracts"][_contractName],
            { endBlock: unknown }
          >["endBlock"]
        | Extract<
            config["contracts"][_contractName]["network"][keyof config["contracts"][_contractName]["network"]],
            { endBlock: unknown }
          >["endBlock"];
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
