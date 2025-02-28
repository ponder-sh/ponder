import type { Config } from "@/config/index.js";
import type {
  FormatEventArgs,
  FormatFunctionArgs,
  FormatFunctionResult,
  SafeEventNames,
  SafeFunctionNames,
} from "@/config/utilityTypes.js";
import type { ReadOnlyClient } from "@/indexing/ponderActions.js";
import type { Schema } from "@/internal/types.js";
import type {
  Block,
  Log,
  Trace,
  Transaction,
  TransactionReceipt,
  Transfer,
} from "@/types/eth.js";
import type { Db } from "./db.js";
import type { Prettify } from "./utils.js";

export namespace Virtual {
  type Setup = "setup";

  type _FormatEventNames<
    contract extends Config["contracts"][string],
    ///
    safeEventNames = SafeEventNames<contract["abi"]>,
  > = string extends safeEventNames ? never : safeEventNames;

  type _FormatFunctionNames<
    contract extends Config["contracts"][string],
    ///
    safeFunctionNames = SafeFunctionNames<contract["abi"]>,
  > = string extends safeFunctionNames ? never : safeFunctionNames;

  /** "{ContractName}:{EventName}" | "{ContractName}.{FunctionName}()" | "{SourceName}:block" | "{SourceName}:transaction:from" . */
  export type FormatEventNames<
    contracts extends Config["contracts"],
    accounts extends Config["accounts"],
    blocks extends Config["blocks"],
  > =
    | {
        [name in keyof contracts]: `${name & string}:${_FormatEventNames<contracts[name]> | Setup}`;
      }[keyof contracts]
    | {
        [name in keyof accounts]: `${name & string}:${"transaction" | "transfer"}:${"from" | "to"}`;
      }[keyof accounts]
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
    source extends Config["contracts" | "accounts"][string],
    ///
    includeTxr = ExtractOverridenProperty<source, "includeTransactionReceipts">,
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
    ? // 1. block event
      {
        id: string;
        block: Prettify<Block>;
      }
    : name extends `${string}:transaction:${"from" | "to"}`
      ? // 2. transaction event
        {
          id: string;
          block: Prettify<Block>;
          transaction: Prettify<Transaction>;
          transactionReceipt: Prettify<TransactionReceipt>;
        }
      : name extends `${string}:transfer:${"from" | "to"}`
        ? // 3. transfer event
          {
            id: string;
            transfer: Prettify<Transfer>;
            block: Prettify<Block>;
            transaction: Prettify<Transaction>;
            trace: Prettify<Trace>;
          } & FormatTransactionReceipts<config["accounts"][sourceName]>
        : name extends `${string}.${string}`
          ? // 4. call trace event
            Prettify<
              {
                id: string;
                args: FormatFunctionArgs<
                  config["contracts"][sourceName]["abi"],
                  eventName
                >;
                result: FormatFunctionResult<
                  config["contracts"][sourceName]["abi"],
                  eventName
                >;
                trace: Prettify<Trace>;
                block: Prettify<Block>;
                transaction: Prettify<Transaction>;
              } & FormatTransactionReceipts<config["contracts"][sourceName]>
            >
          : eventName extends Setup
            ? // 5. setup event
              never
            : // 6. log event
              Prettify<
                {
                  id: string;
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

  type ExtractOverridenProperty<
    contract extends Config["contracts" | "accounts"][string],
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
    client: Prettify<ReadOnlyClient>;
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
  };
}
