import type { Common } from "@/common/common.js";
import type {
  Block,
  CallTrace,
  Log,
  Transaction,
  TransactionReceipt,
} from "@/types/eth.js";
import { decodeEventLog } from "@/utils/decodeEventLog.js";
import { never } from "@/utils/never.js";
import { startClock } from "@/utils/timer.js";
import { type Hex, decodeFunctionData, decodeFunctionResult } from "viem";
import type { Source } from "./source.js";

export type RawEvent = {
  chainId: number;
  sourceIndex: number;
  checkpoint: string;
  log?: Log;
  block: Block;
  transaction?: Transaction;
  transactionReceipt?: TransactionReceipt;
  trace?: CallTrace;
};

export type SetupEvent = {
  type: "setup";
  chainId: number;
  checkpoint: string;

  /** `${source.name}:setup` */
  name: string;

  block: bigint;
};

export type LogEvent = {
  type: "log";
  chainId: number;
  checkpoint: string;

  /** `${source.name}:${safeName}` */
  name: string;

  event: {
    name: string;
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
  checkpoint: string;

  /** `${source.name}:block` */
  name: string;

  event: {
    block: Block;
  };
};

export type CallTraceEvent = {
  type: "callTrace";
  chainId: number;
  checkpoint: string;

  /** `${source.name}.${safeName}()` */
  name: string;

  event: {
    args: any;
    result: any;
    trace: CallTrace;
    block: Block;
    transaction: Transaction;
    transactionReceipt?: TransactionReceipt;
  };
};

export type Event = LogEvent | BlockEvent | CallTraceEvent;

export const decodeEvents = (
  common: Common,
  sources: Source[],
  rawEvents: RawEvent[],
): Event[] => {
  const events: Event[] = [];

  const endClock = startClock();

  for (const event of rawEvents) {
    const source = sources[event.sourceIndex]!;

    switch (source.type) {
      case "block": {
        events.push({
          type: "block",
          chainId: event.chainId,
          checkpoint: event.checkpoint,
          name: `${source.name}:block`,
          event: {
            block: event.block,
          },
        });
        break;
      }
      case "contract": {
        switch (source.filter.type) {
          case "log": {
            try {
              if (
                event.log!.topics[0] === undefined ||
                source.abiEvents.bySelector[event.log!.topics[0]] === undefined
              ) {
                throw new Error();
              }

              const { safeName, item } =
                source.abiEvents.bySelector[event.log!.topics[0]]!;

              const args = decodeEventLog({
                abiItem: item,
                data: event.log!.data,
                topics: event.log!.topics,
              });

              events.push({
                type: "log",
                chainId: event.chainId,
                checkpoint: event.checkpoint,

                name: `${source.name}:${safeName}`,

                event: {
                  name: safeName,
                  args,
                  log: event.log!,
                  block: event.block,
                  transaction: event.transaction!,
                  transactionReceipt: event.transactionReceipt,
                },
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
              const selector = event.trace!.input.slice(0, 10) as Hex;

              if (source.abiFunctions.bySelector[selector] === undefined) {
                throw new Error();
              }

              const { safeName, item } =
                source.abiFunctions.bySelector[selector]!;

              const { args, functionName } = decodeFunctionData({
                abi: [item],
                data: event.trace!.input,
              });

              const result = decodeFunctionResult({
                abi: [item],
                data: event.trace!.output,
                functionName,
              });

              events.push({
                type: "callTrace",
                chainId: event.chainId,
                checkpoint: event.checkpoint,

                name: `${source.name}.${safeName}`,

                event: {
                  args,
                  result,
                  trace: event.trace!,
                  block: event.block,
                  transaction: event.transaction!,
                  transactionReceipt: event.transactionReceipt,
                },
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

  common.metrics.ponder_indexing_abi_decoding_duration.observe(endClock());

  return events;
};
