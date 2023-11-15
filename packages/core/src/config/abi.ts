import { type Abi, type AbiEvent, formatAbiItem } from "abitype";
import { getEventSelector, type Hex } from "viem";

import { getDuplicateElements } from "@/utils/duplicates.js";

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
  bySignature: { [key: string]: AbiEventMeta | undefined };
  bySelector: { [key: Hex]: AbiEventMeta | undefined };
};

export const getEvents = ({ abi }: { abi: Abi }) => {
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
      acc.bySignature[signature] = abiEventMeta;
      acc.bySelector[selector] = abiEventMeta;

      return acc;
    },
    { bySafeName: {}, bySignature: {}, bySelector: {} },
  );
};
