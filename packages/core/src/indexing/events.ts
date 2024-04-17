import type { RawEvent } from "@/sync-store/store.js";
import type { Block, Log, Transaction } from "@/types/eth.js";
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
  };
  encodedCheckpoint: string;
};

export type Event = LogEvent;

export const decodeEvents = (
  { common, sourceById }: Pick<Service, "sourceById" | "common">,
  rawEvents: RawEvent[],
): Event[] => {
  const events: Event[] = [];

  for (const event of rawEvents) {
    try {
      const source = sourceById[event.sourceId];
      const abi = source.abi;

      const decodedLog = decodeEventLog({
        abi,
        data: event.log.data,
        topics: event.log.topics,
      });

      const logEventName =
        source.abiEvents.bySelector[event.log.topics[0]!]!.safeName;

      events.push({
        type: "log",
        chainId: event.chainId,
        contractName: source.contractName,
        logEventName,
        event: {
          args: decodedLog.args,
          log: event.log,
          block: event.block,
          transaction: event.transaction,
        },
        encodedCheckpoint: event.encodedCheckpoint,
      });
    } catch (err) {
      common.logger.debug({
        service: "app",
        msg: `Unable to decode log, skipping it. id: ${event.log.id}, data: ${event.log.data}, topics: ${event.log.topics}`,
      });
    }
  }

  return events;
};
