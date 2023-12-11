import type { AbiEvent } from "abitype";
import type { RpcLog } from "viem";
import { checksumAddress, getEventSelector } from "viem";

import { getBytesConsumedByParam } from "@/utils/offset.js";

import type { FactoryCriteria } from "./sources.js";

export function buildFactoryCriteria({
  address: _address,
  event,
  parameter,
}: {
  address: `0x${string}`;
  event: AbiEvent;
  parameter: string;
}) {
  const address = checksumAddress(_address);
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
    } satisfies FactoryCriteria;
  }

  const nonIndexedInputs = event.inputs.filter(
    (x) => !("indexed" in x && x.indexed),
  );
  const nonIndexedInputPosition = nonIndexedInputs.findIndex(
    (input) => input.name === parameter,
  );

  if (nonIndexedInputPosition === -1) {
    throw new Error(
      `Factory event parameter '${parameter}' not found in factory event signature. Found: ${event.inputs
        .map((i) => i.name)
        .join(", ")}.`,
    );
  }

  let offset = 0;
  for (let i = 0; i < nonIndexedInputPosition; i++) {
    offset += getBytesConsumedByParam(nonIndexedInputs[i]);
  }

  return {
    address,
    eventSelector,
    childAddressLocation: `offset${offset}`,
  } satisfies FactoryCriteria;
}

export function getAddressFromFactoryEventLog({
  criteria,
  log,
}: {
  criteria: FactoryCriteria;
  log: RpcLog;
}) {
  const { childAddressLocation } = criteria;

  if (childAddressLocation.startsWith("topic")) {
    const childAddressTopic = Number(childAddressLocation.substring(5, 6));
    const topic = log.topics[childAddressTopic];
    if (topic === undefined) {
      throw new Error(
        `Invalid log for factory criteria: Not enough topic values, expected at least ${childAddressTopic}`,
      );
    }
    const start = 2 + 12 * 2;
    const end = start + 20 * 2;

    return checksumAddress(("0x" + topic.slice(start, end)) as `0x${string}`);
  }

  if (childAddressLocation.startsWith("offset")) {
    const childAddressOffset = Number(childAddressLocation.substring(6));
    const start = 2 + 12 * 2 + childAddressOffset * 2;
    const end = start + 20 * 2;
    if (log.data.length < end) {
      throw new Error(
        `Invalid log for factory criteria: Data size too small, expected at least ${
          end / 2 - 1
        } bytes`,
      );
    }

    return checksumAddress(
      ("0x" + log.data.slice(start, end)) as `0x${string}`,
    );
  }

  throw new Error(
    `Invalid child address location identifier: ${childAddressLocation}`,
  );
}
