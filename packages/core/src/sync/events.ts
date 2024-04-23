import type { RawEvent } from "@/sync-store/store.js";
import type {
  Block,
  Log,
  Transaction,
  TransactionReceipt,
} from "@/types/eth.js";
import { never } from "@/utils/never.js";
import { decodeEventLog } from "viem";
import type { Service } from "./service.js";

export type SetupEvent = {
  type: "setup";
  chainId: number;
  contractName: string;
  startBlock: bigint;
  encodedCheckpoint: string;
};

export type LogEvent = {
  type: "log";
  chainId: number;
  contractName: string;
  logEventName: string;
  event: {
    args: any;
    log: Log;
    block: Block;
    transaction: Transaction;
    transactionReceipt?: TransactionReceipt;
  };
  encodedCheckpoint: string;
};

export type BlockEvent = {
  type: "block";
  chainId: number;
  blockName: string;
  event: {
    block: Block;
  };
  encodedCheckpoint: string;
};

export type Event = LogEvent | BlockEvent;

export const decodeEvents = (
  { common, sourceById }: Pick<Service, "sourceById" | "common">,
  rawEvents: RawEvent[],
): Event[] => {
  const events: Event[] = [];

  for (const event of rawEvents) {
    const source = sourceById[event.sourceId];

    switch (source.type) {
      case "block": {
        events.push({
          type: "block",
          chainId: event.chainId,
          blockName: source.blockName,
          event: {
            block: event.block,
          },
          encodedCheckpoint: event.encodedCheckpoint,
        });
        break;
      }

      case "factory":
      case "log": {
        try {
          const abi = source.abi;

          const decodedLog = decodeEventLog({
            abi,
            data: event.log!.data,
            topics: event.log!.topics,
          });

          const logEventName =
            source.abiEvents.bySelector[event.log!.topics[0]!]!.safeName;

          events.push({
            type: "log",
            chainId: event.chainId,
            contractName: source.contractName,
            logEventName,
            event: {
              args: decodedLog.args,
              log: event.log!,
              block: event.block,
              transaction: event.transaction!,
              transactionReceipt: event.transactionReceipt,
            },
            encodedCheckpoint: event.encodedCheckpoint,
          });
        } catch (err) {
          // TODO(kyle) Because we are strictly setting all `topics` now, this should be a bigger error.
          common.logger.debug({
            service: "app",
            msg: `Unable to decode log, skipping it. id: ${
              event.log!.id
            }, data: ${event.log!.data}, topics: ${event.log!.topics}`,
          });
        }
        break;
      }

      default:
        never(source);
    }
  }

  return events;
};
