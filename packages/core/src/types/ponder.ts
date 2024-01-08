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
export type Names<contracts extends Config["contracts"]> = {
  [name in keyof contracts]: `${name & string}:${
    | (SafeEventNames<contracts[name]["abi"]> extends infer events extends
        string
        ? contracts[name]["filter"] extends {
            event: infer filterEvents extends string | readonly string[];
          }
          ? Extract<
              events,
              filterEvents extends readonly string[]
                ? filterEvents[number]
                : filterEvents
            >
          : events
        : never)
    | Setup}`;
}[keyof contracts];

type ExtractEventName<name extends string> =
  name extends `${string}:${infer EventName extends string}`
    ? EventName
    : never;

type ExtractContractName<name extends string> =
  name extends `${infer ContractName extends string}:${string}`
    ? ContractName
    : never;

export type PonderApp<TConfig extends Config, TSchema extends Schema> = {
  on: <
    name extends Names<TConfig["contracts"]>,
    ///
    contractName extends ExtractContractName<name> = ExtractContractName<name>,
    eventName extends ExtractEventName<name> = ExtractEventName<name>,
  >(
    _name: name,
    indexingFunction: (
      args: (eventName extends Setup
        ? {}
        : {
            event: {
              name: eventName;
              args: GetEventArgs<
                Abi,
                string,
                {
                  EnableUnion: false;
                  IndexedOnly: false;
                  Required: true;
                },
                ParseAbiEvent<
                  TConfig["contracts"][contractName]["abi"],
                  eventName
                >
              >;
              log: Log;
              block: Block;
              transaction: Transaction;
            };
          }) & {
        context: {
          contracts: {
            [ContractName in keyof TConfig["contracts"]]: {
              abi: TConfig["contracts"][ContractName]["abi"];
              address:
                | Extract<
                    TConfig["contracts"][ContractName],
                    { address: unknown }
                  >["address"]
                | Extract<
                    TConfig["contracts"][ContractName]["network"][keyof TConfig["contracts"][ContractName]["network"]],
                    { address: unknown }
                  >["address"];
              startBlock:
                | Extract<
                    TConfig["contracts"][ContractName],
                    { startBlock: unknown }
                  >["startBlock"]
                | Extract<
                    TConfig["contracts"][ContractName]["network"][keyof TConfig["contracts"][ContractName]["network"]],
                    { startBlock: unknown }
                  >["startBlock"];
              endBlock:
                | Extract<
                    TConfig["contracts"][ContractName],
                    { endBlock: unknown }
                  >["endBlock"]
                | Extract<
                    TConfig["contracts"][ContractName]["network"][keyof TConfig["contracts"][ContractName]["network"]],
                    { endBlock: unknown }
                  >["endBlock"];
            };
          };
          network: TConfig["contracts"][contractName]["network"] extends string
            ? {
                name: TConfig["contracts"][contractName]["network"];
                chainId: TConfig["networks"][TConfig["contracts"][contractName]["network"]]["chainId"];
              }
            : {
                [key in keyof TConfig["contracts"][contractName]["network"]]: {
                  name: key;
                  chainId: TConfig["networks"][key &
                    keyof TConfig["networks"]]["chainId"];
                };
              }[keyof TConfig["contracts"][contractName]["network"]];
          client: Prettify<Omit<ReadOnlyClient, "extend">>;
          db: {
            [key in keyof Infer<TSchema>]: DatabaseModel<Infer<TSchema>[key]>;
          };
        };
      },
    ) => Promise<void> | void,
  ) => void;
};

export type ExtractContext<
  TConfig extends Config,
  TSchema extends Schema,
> = Parameters<Parameters<PonderApp<TConfig, TSchema>["on"]>[1]>[0]["context"];
