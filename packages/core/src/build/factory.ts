import type { LogFactory } from "@/sync/source.js";
import { toLowerCase } from "@/utils/lowercase.js";
import { getBytesConsumedByParam, hasDynamicChild } from "@/utils/offset.js";
import { dedupe } from "@ponder/common";
import type { AbiEvent } from "abitype";
import { type Address, toEventSelector } from "viem";

export function buildLogFactory({
  address: _address,
  event,
  parameter,
  chainId,
}: {
  address: Address | readonly Address[];
  event: AbiEvent;
  parameter: string;
  chainId: number;
}): LogFactory {
  const parameterParts = parameter.split(".");

  let offset = 0;

  const firstParameterSegment = parameterParts[0];

  if (firstParameterSegment === undefined) {
    throw new Error("No parameter provided.");
  }

  const address = Array.isArray(_address)
    ? dedupe(_address).map(toLowerCase)
    : toLowerCase(_address);
  const eventSelector = toEventSelector(event);

  // Check if the provided parameter is present in the list of indexed inputs.
  const indexedInputPosition = event.inputs
    .filter((x) => "indexed" in x && x.indexed)
    .findIndex((input) => input.name === firstParameterSegment);

  if (indexedInputPosition > -1) {
    if (parameterParts.length !== 1) {
      throw new Error(
        "Child parameters of indexed parameters are not accessible",
      );
    }
    return {
      type: "log",
      chainId,
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
    (input) => input.name === firstParameterSegment,
  );

  if (nonIndexedInputPosition === -1) {
    throw new Error(
      `Factory event parameter not found in factory event signature. Got '${firstParameterSegment}', expected one of [${event.inputs
        .map((i) => `'${i.name}'`)
        .join(", ")}].`,
    );
  }

  for (let i = 0; i < nonIndexedInputPosition; i++) {
    offset += getBytesConsumedByParam(nonIndexedInputs[i]!);
  }

  let prvInput = nonIndexedInputs[nonIndexedInputPosition]!;

  for (let i = 1; i < parameterParts.length; i++) {
    if (!("components" in prvInput)) {
      throw new Error(
        `Parameter ${firstParameterSegment} is not a tuple or struct type`,
      );
    }

    const dynamicChildFlag = hasDynamicChild(prvInput);

    if (dynamicChildFlag) {
      for (let j = nonIndexedInputPosition; j < nonIndexedInputs.length; j++) {
        // bytes consumed by successor siblings after the current one
        offset += getBytesConsumedByParam(nonIndexedInputs[j]!);
      }
    }

    const components = prvInput.components;

    const nextParameterSegment = parameterParts[i]!;

    const inputIndex = components.findIndex(
      (input) => input.name === nextParameterSegment,
    );
    if (inputIndex === -1) {
      throw new Error(
        `Factory event parameter not found in factory event signature. Got '${nextParameterSegment}', expected one of [${components
          .map((i) => `'${i.name}'`)
          .join(", ")}].`,
      );
    }
    for (let j = 0; j < inputIndex; j++) {
      offset += getBytesConsumedByParam(components[j]!);
    }
    prvInput = components[inputIndex]!;
  }

  return {
    type: "log",
    chainId,
    address,
    eventSelector,
    childAddressLocation: `offset${offset}`,
  };
}
