import { type Abi, type AbiEvent, formatAbiItem } from "abitype";
import { type Hex, getEventSelector } from "viem";

import { getDuplicateElements } from "@/utils/duplicates";

export type LogEventMetadata = {
  // Event name (if no overloads) or full event signature (if name is overloaded).
  // This is the event name used when registering indexing functions using `ponder.on("ContractName:EventName", ...)`
  safeName: string;
  // Full event signature, e.g. `event Deposit(address indexed from,bytes32 indexed id,uint value);`
  signature: string;
  // Keccak256 hash of the event signature (topic[0]).
  selector: Hex;
  // ABI item used for decoding raw logs.
  abiItem: AbiEvent;
};

type SafeEventName = string;

export type AbiEvents = { [key: SafeEventName]: LogEventMetadata | undefined };

export const getEvents = ({ abi }: { abi: Abi }) => {
  const abiEvents = abi
    .filter((item): item is AbiEvent => item.type === "event")
    .filter((item) => item.anonymous === undefined || item.anonymous === false);

  const overloadedEventNames = getDuplicateElements(
    abiEvents.map((item) => item.name)
  );

  return abiEvents.reduce<AbiEvents>((acc, item) => {
    const signature = formatAbiItem(item);

    const safeName = overloadedEventNames.has(item.name)
      ? signature.split("event ")[1]
      : item.name;

    acc[safeName] = {
      safeName,
      signature,
      selector: getEventSelector(item),
      abiItem: item,
    };
    return acc;
  }, {});
};
