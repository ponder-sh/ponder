import { toLowerCase } from "@/utils/lowercase.js";
import { getBytesConsumedByParam } from "@/utils/offset.js";
import type { AbiEvent } from "abitype";
import { getEventSelector } from "viem";
import type { ChildAddressCriteria } from "./sources.js";

export function buildChildAddressCriteria({
  address: _address,
  event,
  parameter,
}: {
  address: `0x${string}`;
  event: AbiEvent;
  parameter: string;
}): ChildAddressCriteria {
  const address = toLowerCase(_address);
  const eventSelector = getEventSelector(event);

  // Check if the provided parameter is present in the list of indexed inputs.
  const indexedInputPosition = event.inputs
    .filter((x) => "indexed" in x && x.indexed)
    .findIndex((input) => input.name === parameter);

  if (indexedInputPosition > -1) {
    return {
      address,
      eventSelector,
      // Add 1 because inputs will not contain an element for topic0 (the signature).
      childAddressLocation: `topic${(indexedInputPosition + 1) as 1 | 2 | 3}`,
    };
  }

  const nonIndexedInputs = event.inputs.filter(
    (x) => !("indexed" in x && x.indexed),
  );
  const nonIndexedInputPosition = nonIndexedInputs.findIndex(
    (input) => input.name === parameter,
  );

  if (nonIndexedInputPosition === -1) {
    throw new Error(
      `Factory event parameter not found in factory event signature. Got '${parameter}', expected one of [${event.inputs
        .map((i) => `'${i.name}'`)
        .join(", ")}].`,
    );
  }

  let offset = 0;
  for (let i = 0; i < nonIndexedInputPosition; i++) {
    offset += getBytesConsumedByParam(nonIndexedInputs[i]!);
  }

  return {
    address,
    eventSelector,
    childAddressLocation: `offset${offset}`,
  };
}
