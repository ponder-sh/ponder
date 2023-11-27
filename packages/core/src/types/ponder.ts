import type { AbiEvent } from "abitype";
import type { Abi, GetEventArgs } from "viem";

import type {
  Config,
  FilterAbiEvents,
  RecoverAbiEvent,
  SafeEventNames,
} from "@/config/config.js";
import type { ReadOnlyClient } from "@/indexing/ponderActions.js";
import type { Infer, Schema } from "@/schema/types.js";
import type { Block } from "@/types/block.js";
import type { Log } from "@/types/log.js";
import type { DatabaseModel } from "@/types/model.js";
import type { Transaction } from "@/types/transaction.js";

import type { Prettify } from "./utils.js";

type Setup = "setup";

/** "{ContractName}:{EventName}". */
export type Names<TContracts extends Config["contracts"]> = {
  [key in keyof TContracts]: `${key & string}:${
    | (SafeEventNames<
        FilterAbiEvents<TContracts[key]["abi"]>
      >[number] extends infer events extends string
        ? TContracts[key]["filter"] extends {
            event: infer filterEvents extends string | string[];
          }
          ? Extract<
              events,
              filterEvents extends string[]
                ? filterEvents[number]
                : filterEvents
            >
          : events
        : never)
    | Setup}`;
}[keyof TContracts];

type ExtractEventName<TName extends string> =
  TName extends `${string}:${infer EventName extends string}`
    ? EventName
    : never;

type ExtractContractName<TName extends string> =
  TName extends `${infer ContractName extends string}:${string}`
    ? ContractName
    : never;

export type PonderApp<TConfig extends Config, TSchema extends Schema> = {
  on: <
    TName extends Names<TConfig["contracts"]>,
    TContractName extends
      ExtractContractName<TName> = ExtractContractName<TName>,
    TEventName extends ExtractEventName<TName> = ExtractEventName<TName>,
  >(
    name: TName,
    indexingFunction: (
      args: (TEventName extends Setup
        ? {}
        : {
            event: {
              name: TEventName;
              args: GetEventArgs<
                Abi,
                string,
                {
                  EnableUnion: false;
                  IndexedOnly: false;
                  Required: true;
                },
                AbiEvent &
                  RecoverAbiEvent<
                    FilterAbiEvents<TConfig["contracts"][TContractName]["abi"]>,
                    TEventName
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
          network: TConfig["contracts"][TContractName]["network"] extends string
            ? {
                name: TConfig["contracts"][TContractName]["network"];
                chainId: TConfig["networks"][TConfig["contracts"][TContractName]["network"]]["chainId"];
              }
            : {
                [key in keyof TConfig["contracts"][TContractName]["network"]]: {
                  name: key;
                  chainId: TConfig["networks"][key &
                    keyof TConfig["networks"]]["chainId"];
                };
              }[keyof TConfig["contracts"][TContractName]["network"]];
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
