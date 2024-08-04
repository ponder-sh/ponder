import type { PonderSyncSchema } from "@/sync-store/encoding.js";
import type {
  Block,
  CallTrace,
  Log,
  Transaction,
  TransactionReceipt,
} from "@/types/eth.js";
import type { AbiEvent } from "abitype";
import { type Hex, decodeEventLog, getEventSelector } from "viem";
import type { ContractSource, Source } from "./source.js";

export type RawEvent = PonderSyncSchema["logs"] &
  PonderSyncSchema["blocks"] & { filterId: string };

export type RawLogData = {
  data: Hex;
  topic0: Hex | null;
  topic1: Hex | null;
  topic2: Hex | null;
  topic3: Hex | null;
};

export type SetupEvent = {
  type: "setup";
  chainId: number;
  contractName: string;
  startBlock: bigint;
  encodedCheckpoint: string;
};

export type LogEvent = {
  type: "log";
  source: ContractSource;
  checkpoint: string;

  logEventName: string;
  event: {
    args: any;
    log: Log;
    block: Block;
    transaction: Transaction;
    transactionReceipt?: TransactionReceipt;
  };
};

export type BlockEvent = {
  type: "block";
  chainId: number;
  sourceName: string;
  event: {
    block: Block;
  };
  encodedCheckpoint: string;
};

export type CallTraceEvent = {
  type: "callTrace";
  chainId: number;
  contractName: string;
  functionName: string;
  event: {
    args: any;
    result: any;
    trace: CallTrace;
    block: Block;
    transaction: Transaction;
    transactionReceipt?: TransactionReceipt;
  };
  encodedCheckpoint: string;
};

export type Event = LogEvent | BlockEvent | CallTraceEvent;

export const decodeEvents = (args: {
  sources: Source[];
  events: RawEvent[];
}): Event[] => {
  const abiCache: { [filterId: string]: { [selector: Hex]: AbiEvent } } = {};
  const nameCache: { [filterId: string]: string } = {};

  for (const source of args.sources) {
    if (source.type === "block") continue;

    const filterId = getFilterId("event", source.filter);
    abiCache[filterId] = {};
    nameCache[filterId] = source.name;

    for (const item of source.abi) {
      if (item.type !== "event") continue;
      const selector = getEventSelector(item);
      abiCache[filterId]![selector] = item;
    }
  }

  for (let i = 0; i < args.events.length; i++) {
    const event = args.events[i]!;
    const data = event.data! as RawLogData;

    const abiItem = abiCache[event.filter_id]![data.topic0!]!;
    const _args = decodeEventLog({
      abi: [abiItem],
      data: data.data,
      topics: [data.topic0!, data.topic1!, data.topic2!, data.topic3!],
    }).args;
    const name = nameCache[event.filter_id]!;
    // @ts-ignore
    event.data = undefined;
    // @ts-ignore
    event.filter_id = undefined;
    // @ts-ignore
    event.type = "log";
    // @ts-ignore
    event.chainId = event.chain_id;
    // @ts-ignore
    event.chain_id = undefined;
    // @ts-ignore
    event.contractName = name;
    // @ts-ignore
    event.logEventName = abiItem.name;
    // @ts-ignore
    event.event = {};
    // @ts-ignore
    event.event.args = _args;
    // @ts-ignore
    event.event.id = event.checkpoint;
  }

  return args.events as unknown as Event[];
};
