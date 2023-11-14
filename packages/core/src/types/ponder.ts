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

/** "{ContractName}:{EventName}". */
export type Names<TContracts extends Config["contracts"]> = {
  [key in keyof TContracts]: `${key & string}:${SafeEventNames<
    FilterAbiEvents<TContracts[key]["abi"]>
  >[number]}`;
}[keyof TContracts];

export type PonderApp<TConfig extends Config, TSchema extends Schema> = {
  on: <TName extends Names<TConfig["contracts"]>>(
    name: TName,
    indexingFunction: ({
      event,
      context,
    }: {
      event: {
        name: TName extends `${string}:${infer EventName}` ? EventName : string;
        args: GetEventArgs<
          Abi,
          string,
          {
            EnableUnion: false;
            IndexedOnly: false;
            Required: true;
          },
          TName extends `${infer ContractName}:${infer EventName}`
            ? RecoverAbiEvent<
                TConfig["contracts"][ContractName] extends {
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
        network: TName extends `${infer ContractName}:${string}`
          ? {
              [key in keyof TConfig["contracts"][ContractName]["network"]]: {
                name: key;
                chainId: TConfig["networks"][key &
                  keyof TConfig["networks"]]["chainId"];
              };
            }[keyof TConfig["contracts"][ContractName]["network"]]
          : never;
        client: Prettify<Omit<ReadOnlyClient, "extend">>;
        db: {
          [key in keyof Infer<TSchema>]: DatabaseModel<Infer<TSchema>[key]>;
        };
      };
    }) => Promise<void> | void,
  ) => void;
};
