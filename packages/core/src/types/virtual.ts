import type { Config } from "@/config/config.js";
import type { ParseAbiEvent, SafeEventNames } from "@/config/utilityTypes.js";
import type { ReadOnlyClient } from "@/indexing/ponderActions.js";
import type { Infer, Schema as _Schema } from "@/schema/types.js";
import type {
  Block,
  Log,
  Transaction,
  TransactionReceipt,
} from "@/types/eth.js";
import type { DatabaseModel } from "@/types/model.js";
import type { Abi, GetEventArgs } from "viem";
import type { Prettify } from "./utils.js";

export namespace Virtual {
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
  export type FormatEventNames<
    contracts extends Config["contracts"],
    blocks extends Config["blocks"],
  > =
    | {
        [name in keyof contracts]: `${name & string}:${
          | _FormatEventNames<contracts[name]>
          | Setup}`;
      }[keyof contracts]
    | {
        [name in keyof blocks]: `${name & string}:block`;
      }[keyof blocks];

  export type ExtractEventName<name extends string> =
    name extends `${string}:${infer EventName extends string}`
      ? EventName
      : never;

  export type ExtractSourceName<name extends string> =
    name extends `${infer SourceName extends string}:${string}`
      ? SourceName
      : never;

  export type EventNames<config extends Config> = FormatEventNames<
    config["contracts"],
    config["blocks"]
  >;

  export type Event<
    config extends Config,
    name extends EventNames<config>,
    ///
    contractName extends ExtractSourceName<name> = ExtractSourceName<name>,
    eventName extends ExtractEventName<name> = ExtractEventName<name>,
  > = name extends `${string}:block`
    ? { block: Prettify<Block> }
    : eventName extends Setup
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
          log: Prettify<Log>;
          block: Prettify<Block>;
          transaction: Prettify<Transaction>;
        } & (ExtractOverridenProperty<
          config["contracts"][contractName],
          "includeTransactionReceipts"
        > extends infer includeTxr
          ? includeTxr extends includeTxr
            ? includeTxr extends true
              ? {
                  transactionReceipt: Prettify<TransactionReceipt>;
                }
              : {
                  transactionReceipt?: never;
                }
            : never
          : never);

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

  export type Context<
    config extends Config,
    schema extends _Schema,
    name extends EventNames<config>,
    ///
    sourceName extends ExtractSourceName<name> = ExtractSourceName<name>,
    sourceNetwork = unknown extends config["blocks"][sourceName]["network"]
      ? never
      : config["blocks"][sourceName]["network"],
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
    b?: sourceNetwork;
    network: sourceNetwork extends string
      ? // 1. No network overriding
        {
          name: sourceNetwork;
          chainId: config["networks"][sourceNetwork]["chainId"];
        }
      : // 2. Network overrides
        {
          [key in keyof sourceNetwork]: {
            name: key;
            chainId: config["networks"][key &
              keyof config["networks"]]["chainId"];
          };
        }[keyof sourceNetwork];
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

  export type IndexingFunctionArgs<
    config extends Config,
    schema extends _Schema,
    name extends EventNames<config>,
  > = {
    event: Event<config, name>;
    context: Context<config, schema, name>;
  };

  export type Schema<schema extends _Schema> = Infer<schema>;

  export type Registry<config extends Config, schema extends _Schema> = {
    on: <name extends EventNames<config>>(
      _name: name,
      indexingFunction: (
        args: { event: Event<config, name> } & {
          context: Prettify<Context<config, schema, name>>;
        },
      ) => Promise<void> | void,
    ) => void;
  };
}
