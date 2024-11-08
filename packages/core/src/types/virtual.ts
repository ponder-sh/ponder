import type { Config } from "@/config/config.js";
import type {
  FormatEventArgs,
  FormatFunctionArgs,
  FormatFunctionResult,
  SafeEventNames,
  SafeFunctionNames,
} from "@/config/utilityTypes.js";
import type { Drizzle, Schema } from "@/drizzle/index.js";
import type { ReadOnlyClient } from "@/indexing/ponderActions.js";
import type {
  Block,
  CallTrace,
  Log,
  Transaction,
  TransactionReceipt,
} from "@/types/eth.js";
import type { ApiRegistry } from "./api.js";
import type { Db } from "./db.js";
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

  type _FormatFunctionNames<
    contract extends Config["contracts"][string],
    ///
    safeFunctionNames = SafeFunctionNames<contract["abi"]>,
  > = string extends safeFunctionNames ? never : safeFunctionNames;

  /** "{ContractName}:{EventName}" | "{ContractName}.{FunctionName}()" | "{SourceName}:block" . */
  export type FormatEventNames<
    contracts extends Config["contracts"],
    blocks extends Config["blocks"],
  > =
    | {
        [name in keyof contracts]: `${name & string}:${_FormatEventNames<contracts[name]> | Setup}`;
      }[keyof contracts]
    | {
        [name in keyof blocks]: `${name & string}:block`;
      }[keyof blocks]
    | {
        [name in keyof contracts]: true extends ExtractOverridenProperty<
          contracts[name],
          "includeCallTraces"
        >
          ? `${name & string}.${_FormatFunctionNames<contracts[name]>}`
          : never;
      }[keyof contracts];

  type FormatTransactionReceipts<
    contract extends Config["contracts"][string],
    ///
    includeTxr = ExtractOverridenProperty<
      contract,
      "includeTransactionReceipts"
    >,
  > = includeTxr extends includeTxr
    ? includeTxr extends true
      ? {
          transactionReceipt: Prettify<TransactionReceipt>;
        }
      : {
          transactionReceipt?: never;
        }
    : never;

  export type ExtractEventName<name extends string> =
    name extends `${string}:${infer EventName extends string}`
      ? EventName
      : name extends `${string}.${infer EventName extends string}`
        ? EventName
        : never;

  export type ExtractSourceName<name extends string> =
    name extends `${infer SourceName extends string}:${string}`
      ? SourceName
      : name extends `${infer SourceName extends string}.${string}`
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
    : name extends `${string}.${string}`
      ? Prettify<
          {
            args: FormatFunctionArgs<
              config["contracts"][contractName]["abi"],
              eventName
            >;
            result: FormatFunctionResult<
              config["contracts"][contractName]["abi"],
              eventName
            >;
            trace: Prettify<CallTrace>;
            block: Prettify<Block>;
            transaction: Prettify<Transaction>;
          } & FormatTransactionReceipts<config["contracts"][contractName]>
        >
      : eventName extends Setup
        ? never
        : Prettify<
            {
              name: eventName;
              args: FormatEventArgs<
                config["contracts"][contractName]["abi"],
                eventName
              >;
              log: Prettify<Log>;
              block: Prettify<Block>;
              transaction: Prettify<Transaction>;
            } & FormatTransactionReceipts<config["contracts"][contractName]>
          >;

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
    schema extends Schema,
    name extends EventNames<config>,
    ///
    sourceName extends ExtractSourceName<name> = ExtractSourceName<name>,
    sourceNetwork = sourceName extends sourceName
      ?
          | (unknown extends config["contracts"][sourceName]["network"]
              ? never
              : config["contracts"][sourceName]["network"])
          | (unknown extends config["blocks"][sourceName]["network"]
              ? never
              : config["blocks"][sourceName]["network"])
      : never,
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
        | "ccipRead"
      >
    >;
    db: Db<schema>;
  };

  export type IndexingFunctionArgs<
    config extends Config,
    schema extends Schema,
    name extends EventNames<config>,
  > = {
    event: Event<config, name>;
    context: Context<config, schema, name>;
  };

  export type Registry<config extends Config, schema extends Schema> = {
    on: <name extends EventNames<config>>(
      _name: name,
      indexingFunction: (
        args: { event: Event<config, name> } & {
          context: Prettify<Context<config, schema, name>>;
        },
      ) => Promise<void> | void,
    ) => void;
  } & ApiRegistry<schema>;

  export type ApiContext<schema extends Schema> = {
    db: Drizzle<schema>;
  };
}
