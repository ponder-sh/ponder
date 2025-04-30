import { getDuplicateElements } from "@/utils/duplicates.js";
import {
  type Abi,
  type AbiEvent,
  type AbiFunction,
  formatAbiItem,
} from "abitype";
import {
  type GetEventArgs,
  type Hex,
  encodeEventTopics,
  getAbiItem,
  parseAbiItem,
} from "viem";
import type { Config } from "../config/index.js";

export const toSafeName = ({
  abi,
  item,
}: { abi: Abi; item: AbiEvent | AbiFunction }) => {
  if (item.type === "event") {
    const abiEvents = abi
      .filter((item): item is AbiEvent => item.type === "event")
      .filter(
        (item) => item.anonymous === undefined || item.anonymous === false,
      );

    const overloadedEventNames = getDuplicateElements(
      abiEvents.map((item) => item.name),
    );

    if (overloadedEventNames.has(item.name)) {
      return formatAbiItem(item).split("event ")[1]!;
    }
    return item.name;
  } else {
    const abiFunctions = abi.filter(
      (item): item is AbiFunction => item.type === "function",
    );

    const overloadedFunctionNames = getDuplicateElements(
      abiFunctions.map((item) => item.name),
    );

    if (overloadedFunctionNames.has(item.name)) {
      return formatAbiItem(item).split("function ")[1]!;
    }
    return `${item.name}()`;
  }
};

export function buildTopics(
  abi: Abi,
  filter: NonNullable<Config["contracts"][string]["filter"]>,
): {
  topic0: Hex;
  topic1: Hex | Hex[] | null;
  topic2: Hex | Hex[] | null;
  topic3: Hex | Hex[] | null;
}[] {
  const filters = Array.isArray(filter) ? filter : [filter];

  const topics = filters.map((filter) => {
    // Single event with args
    const topics = encodeEventTopics({
      abi: [findAbiEvent(abi, filter.event)],
      args: filter.args as GetEventArgs<Abi, string>,
    });

    return {
      topic0: topics[0],
      topic1: topics[1] ?? null,
      topic2: topics[2] ?? null,
      topic3: topics[3] ?? null,
    };
  });

  return topics;
}

/**
 * Finds the event ABI item for the event name or event signature.
 *
 * @param eventName Event name or event signature if there are duplicates
 */
const findAbiEvent = (abi: Abi, eventName: string): AbiEvent => {
  if (eventName.includes("(")) {
    // full event signature
    return parseAbiItem(`event ${eventName}`) as AbiEvent;
  } else {
    return getAbiItem({ abi, name: eventName }) as AbiEvent;
  }
};
