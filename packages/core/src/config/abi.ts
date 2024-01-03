import { type Abi, type AbiEvent, formatAbiItem } from "abitype";
import {
  type GetEventArgs,
  type Hex,
  encodeEventTopics,
  getAbiItem,
  getEventSelector,
  parseAbiItem,
} from "viem";

import { getDuplicateElements } from "@/utils/duplicates.js";
import type { Config } from "./config.js";
import type { Topics } from "./sources.js";

/**
 * Fix issue with Array.isArray not checking readonly arrays
 * {@link https://github.com/microsoft/TypeScript/issues/17002}
 */
declare global {
  interface ArrayConstructor {
    isArray(arg: ReadonlyArray<any> | any): arg is ReadonlyArray<any>;
  }
}

type AbiEventMeta = {
  // Event name (if no overloads) or full event signature (if name is overloaded).
  // This is the event name used when registering indexing functions using `ponder.on("ContractName:EventName", ...)`
  safeName: string;
  // Full event signature, e.g. `event Deposit(address indexed from,bytes32 indexed id,uint value);`
  signature: string;
  // Keccak256 hash of the event signature (topic[0]).
  selector: Hex;
  // ABI item used for decoding raw logs.
  item: AbiEvent;
};

export type AbiEvents = {
  bySafeName: { [key: string]: AbiEventMeta | undefined };
  bySelector: { [key: Hex]: AbiEventMeta | undefined };
};

export const buildAbiEvents = ({ abi }: { abi: Abi }) => {
  const abiEvents = abi
    .filter((item): item is AbiEvent => item.type === "event")
    .filter((item) => item.anonymous === undefined || item.anonymous === false);

  const overloadedEventNames = getDuplicateElements(
    abiEvents.map((item) => item.name),
  );

  return abiEvents.reduce<AbiEvents>(
    (acc, item) => {
      const signature = formatAbiItem(item);
      const safeName = overloadedEventNames.has(item.name)
        ? signature.split("event ")[1]
        : item.name;
      const selector = getEventSelector(item);

      const abiEventMeta = { safeName, signature, selector, item };

      acc.bySafeName[safeName] = abiEventMeta;
      acc.bySelector[selector] = abiEventMeta;

      return acc;
    },
    { bySafeName: {}, bySelector: {} },
  );
};

export function buildTopics(
  abi: Abi,
  filter: NonNullable<Config["contracts"][string]["filter"]>,
): Topics {
  if (Array.isArray(filter.event)) {
    // List of event signatures
    return [
      filter.event.map((event) => getEventSelector(findAbiEvent(abi, event))),
    ];
  } else {
    // Single event with args
    return encodeEventTopics({
      abi: [findAbiEvent(abi, filter.event)],
      args: filter.args as GetEventArgs<Abi, string>,
    });
  }
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
