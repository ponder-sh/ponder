import type { Config } from "@/config/config.js";
import type {
  FormatEventArgs,
  FormatFunctionArgs,
  FormatFunctionResult,
  SafeEventNames,
  SafeFunctionNames,
} from "@/config/utilityTypes.js";
import type { ReadOnlyClient } from "@/indexing/ponderActions.js";
import type { Schema as BuilderSchema } from "@/schema/common.js";
import type { InferSchemaType } from "@/schema/infer.js";
import type {
  Block,
  CallTrace,
  Log,
  Transaction,
  TransactionReceipt,
} from "@/types/eth.js";
import type { DatabaseModel } from "@/types/model.js";
import type { ApiRegistry, ApiContext as _ApiContext } from "./api.js";
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

  /** "{ContractName}:{EventName}" | "{ContractName}.{FunctionName}()" | "{SourceName}:block" | "{SourceName}/Transfer" | "{SourceName}/Transaction". */
  export type FormatEventNames<
    contracts extends Config["contracts"],
    accounts extends Config["accounts"],
    blocks extends Config["blocks"],
  > =
    | {
        [name in keyof contracts]: `${name & string}:${_FormatEventNames<contracts[name]> | Setup}`;
      }[keyof contracts]
    | {
        [name in keyof blocks]: `${name & string}:block`;
      }[keyof blocks]
    | {
        [name in keyof accounts]:
          | `${name & string}/Transfer`
          | `${name & string}/Transaction`;
      }[keyof accounts]
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
    config["accounts"],
    config["blocks"]
  >;

  export type Event<
    config extends Config,
    name extends EventNames<config>,
    ///
    sourceName extends ExtractSourceName<name> = ExtractSourceName<name>,
    eventName extends ExtractEventName<name> = ExtractEventName<name>,
  > = name extends `${string}:block`
    ? { block: Prettify<Block> }
    : name extends `${string}/Transfer`
      ? Prettify<
          {
            trace: Prettify<CallTrace>;
            block: Prettify<Block>;
            transaction: Prettify<Transaction>;
          } & FormatTransactionReceipts<config["accounts"][sourceName]>
        >
      : name extends `${string}/Transaction`
        ? Prettify<
            {
              block: Prettify<Block>;
              transaction: Prettify<Transaction>;
            } & FormatTransactionReceipts<config["accounts"][sourceName]>
          >
        : name extends `${string}.${string}`
          ? Prettify<
              {
                args: FormatFunctionArgs<
                  config["contracts"][sourceName]["abi"],
                  eventName
                >;
                result: FormatFunctionResult<
                  config["contracts"][sourceName]["abi"],
                  eventName
                >;
                trace: Prettify<CallTrace>;
                block: Prettify<Block>;
                transaction: Prettify<Transaction>;
              } & FormatTransactionReceipts<config["contracts"][sourceName]>
            >
          : eventName extends Setup
            ? never
            : Prettify<
                {
                  name: eventName;
                  args: FormatEventArgs<
                    config["contracts"][sourceName]["abi"],
                    eventName
                  >;
                  log: Prettify<Log>;
                  block: Prettify<Block>;
                  transaction: Prettify<Transaction>;
                } & FormatTransactionReceipts<config["contracts"][sourceName]>
              >;

  type ContextContractProperty = Exclude<
    keyof Config["contracts"][string],
    "abi" | "network" | "filter" | "factory"
  >;

  type ContextAccountProperty = Exclude<
    keyof Config["accounts"][string],
    "abi" | "network" | "filter" | "transaction" | "transfer"
  >;

  type ExtractOverridenProperty<
    source extends Config["contracts"][string] | Config["accounts"][string],
    property extends ContextContractProperty | ContextAccountProperty,
    ///
    base = Extract<source, { [p in property]: unknown }>[property],
    override = Extract<
      source["network"][keyof source["network"]],
      { [p in property]: unknown }
    >[property],
  > = ([base] extends [never] ? undefined : base) | override;

  export type Context<
    config extends Config,
    schema extends BuilderSchema,
    name extends EventNames<config>,
    ///
    sourceName extends ExtractSourceName<name> = ExtractSourceName<name>,
    sourceNetwork = sourceName extends sourceName
      ?
          | (unknown extends config["contracts"][sourceName]["network"]
              ? never
              : config["contracts"][sourceName]["network"])
          | (unknown extends config["accounts"][sourceName]["network"]
              ? never
              : config["accounts"][sourceName]["network"])
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
    accounts: {
      [_accountName in keyof config["accounts"]]: {
        abi: config["contracts"][_accountName]["abi"];
        startBlock: ExtractOverridenProperty<
          config["accounts"][_accountName],
          "startBlock"
        >;
        endBlock: ExtractOverridenProperty<
          config["accounts"][_accountName],
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
    db: {
      [key in keyof InferSchemaType<schema>]: DatabaseModel<
        // @ts-ignore
        InferSchemaType<schema>[key]
      >;
    };
  };

  export type Drizzle<schema extends BuilderSchema> = _ApiContext<schema>;

  export type IndexingFunctionArgs<
    config extends Config,
    schema extends BuilderSchema,
    name extends EventNames<config>,
  > = {
    event: Event<config, name>;
    context: Context<config, schema, name>;
  };

  export type Schema<schema extends BuilderSchema> = InferSchemaType<schema>;

  export type Registry<config extends Config, schema extends BuilderSchema> = {
    on: <name extends EventNames<config>>(
      _name: name,
      indexingFunction: (
        args: { event: Event<config, name> } & {
          context: Prettify<Context<config, schema, name>>;
        },
      ) => Promise<void> | void,
    ) => void;
  } & ApiRegistry<schema>;
}
