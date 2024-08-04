import type { Common } from "@/common/common.js";
import type {
  Block,
  CallTrace,
  Log,
  Transaction,
  TransactionReceipt,
} from "@/types/eth.js";
import { never } from "@/utils/never.js";
import {
  type Hex,
  decodeEventLog,
  decodeFunctionData,
  decodeFunctionResult,
} from "viem";
import type { Source } from "./source.js";

export type RawEvent = {
  chainId: number;
  sourceIndex: number;
  log?: Log;
  block: Block;
  transaction?: Transaction;
  transactionReceipt?: TransactionReceipt;
  trace?: CallTrace;
  encodedCheckpoint: string;
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

export const decodeEvents = (
  common: Common,
  sources: Source[],
  rawEvents: RawEvent[],
): Event[] => {
  const events: Event[] = [];

  for (const event of rawEvents) {
    const source = sources[event.sourceIndex]!;

    switch (source.type) {
      case "block": {
        events.push({
          type: "block",
          chainId: event.chainId,
          sourceName: source.name,
          event: {
            block: event.block,
          },
          encodedCheckpoint: event.encodedCheckpoint,
        });
        break;
      }
      case "contract": {
        const abi = source.abi;

        switch (source.filter.type) {
          case "log": {
            try {
              const decodedLog = decodeEventLog({
                abi,
                data: event.log!.data,
                topics: event.log!.topics,
              });

              if (
                event.log!.topics[0] === undefined ||
                source.abiEvents.bySelector[event.log!.topics[0]] === undefined
              ) {
                throw new Error();
              }

              const logEventName =
                source.abiEvents.bySelector[event.log!.topics[0]]!.safeName;

              events.push({
                type: "log",
                chainId: event.chainId,
                contractName: source.name,
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
                msg: `Unable to decode log, skipping it. id: ${event.log?.id}, data: ${event.log?.data}, topics: ${event.log?.topics}`,
              });
            }
            break;
          }

          case "callTrace": {
            try {
              const data = decodeFunctionData({
                abi,
                data: event.trace!.input,
              });

              const result = decodeFunctionResult({
                abi,
                data: event.trace!.output,
                functionName: data.functionName,
              });

              const selector = event.trace!.input.slice(0, 10) as Hex;

              if (source.abiFunctions.bySelector[selector] === undefined) {
                throw new Error();
              }

              const functionName =
                source.abiFunctions.bySelector[selector]!.safeName;

              events.push({
                type: "callTrace",
                chainId: event.chainId,
                contractName: source.name,
                functionName,
                event: {
                  args: data.args,
                  result,
                  trace: event.trace!,
                  block: event.block,
                  transaction: event.transaction!,
                  transactionReceipt: event.transactionReceipt,
                },
                encodedCheckpoint: event.encodedCheckpoint,
              });
            } catch (err) {
              common.logger.debug({
                service: "app",
                msg: `Unable to decode trace, skipping it. id: ${event.trace?.id}, input: ${event.trace?.input}, output: ${event.trace?.output}`,
              });
            }
            break;
          }

          default:
            never(source.filter);
        }
        break;
      }

      default:
        never(source);
    }
  }

  return events;
};
