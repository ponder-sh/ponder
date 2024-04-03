import type { Source } from "@/config/sources.js";
import type { SyncService } from "@/sync/service.js";
import type { Block, Log, Transaction } from "@/types/eth.js";
import { decodeEventLog } from "viem";

export type RawEvents = Awaited<ReturnType<SyncService["getEvents"]>>["events"];

export type SetupEvent = {
  type: "setup";
  chainId: number;
  contractName: string;
  startBlock: bigint;
  eventName: "setup";
  encodedCheckpoint: string;
};

export type LogEvent = {
  type: "log";
  chainId: number;
  contractName: string;
  eventName: string;
  event: {
    args: any;
    log: Log;
    block: Block;
    transaction: Transaction;
  };
  encodedCheckpoint: string;
};

export type PlaceholderEvent = {
  type: "placeholder";
  chainId: number;
  contractName: string;
  eventName: string;
  event: {};
  encodedCheckpoint: string;
};

export type Event = SetupEvent | LogEvent | PlaceholderEvent;

export const decodeEvents = (
  rawEvents: RawEvents,
  sourceById: { [sourceId: string]: Source },
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

      events.push({
        type: "log",
        chainId: event.chainId,
        contractName: source.contractName,
        eventName: decodedLog.eventName,
        event: {
          args: decodedLog.args,
          log: event.log,
          block: event.block,
          transaction: event.transaction,
        },
        encodedCheckpoint: event.encodedCheckpoint,
      });
    } catch (err) {
      // TODO(kyle) cannot decode
    }
  }

  return events;
};
