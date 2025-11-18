import type { LogFactory } from "@/internal/types.js";
import { dedupe } from "@/utils/dedupe.js";
import { toLowerCase } from "@/utils/lowercase.js";
import {
  type TupleAbiParameter,
  getBytesConsumedByParam,
  getNestedParamOffset,
} from "@/utils/offset.js";
import type { AbiEvent } from "abitype";
import { type Address, toEventSelector } from "viem";

export function buildLogFactory({
  address: _address,
  event,
  parameter,
  chainId,
  sourceId,
  fromBlock,
  toBlock,
}: {
  address?: Address | readonly Address[];
  event: AbiEvent;
  parameter: string;
  chainId: number;
  sourceId: string;
  fromBlock: number | undefined;
  toBlock: number | undefined;
}): LogFactory {
  let address: Address | Address[] | undefined;
  if (_address === undefined) {
    // noop
  } else if (Array.isArray(_address)) {
    address = dedupe(_address)
      .map(toLowerCase)
      .sort((a, b) => (a < b ? -1 : 1));
  } else {
    address = toLowerCase(_address);
  }

  const eventSelector = toEventSelector(event);

  const params = parameter.split(".");

  if (params.length === 1) {
    // Check if the provided parameter is present in the list of indexed inputs.
    const indexedInputPosition = event.inputs
      .filter((x) => "indexed" in x && x.indexed)
      .findIndex((input) => {
        return input.name === params[0];
      });

    if (indexedInputPosition > -1) {
      return {
        id: `log_${Array.isArray(address) ? address.join("_") : address}_${chainId}_topic${(indexedInputPosition + 1) as 1 | 2 | 3}_${eventSelector}_${fromBlock ?? "undefined"}_${toBlock ?? "undefined"}`,
        type: "log",
        chainId,
        sourceId,
        address,
        eventSelector,
        // Add 1 because inputs will not contain an element for topic0 (the signature).
        childAddressLocation: `topic${(indexedInputPosition + 1) as 1 | 2 | 3}`,
        fromBlock,
        toBlock,
      };
    }
  }

  const nonIndexedInputs = event.inputs.filter(
    (x) => !("indexed" in x && x.indexed),
  );
  const nonIndexedInputPosition = nonIndexedInputs.findIndex(
    (input) => input.name === params[0],
  );

  if (nonIndexedInputPosition === -1) {
    throw new Error(
      `Factory event parameter not found in factory event signature. Got '${parameter}', expected one of [${event.inputs
        .map((i) => `'${i.name}'`)
        .join(", ")}].`,
    );
  }

  const nonIndexedParameter = nonIndexedInputs[nonIndexedInputPosition]!;

  if (nonIndexedParameter.type !== "address" && params.length === 1) {
    throw new Error(
      `Factory event parameter type is not valid. Got '${nonIndexedParameter.type}', expected 'address'.`,
    );
  }

  if (params.length > 1 && nonIndexedParameter.type !== "tuple") {
    throw new Error(
      `Factory event parameter type is not valid. Got '${nonIndexedParameter.type}', expected 'tuple'.`,
    );
  }

  let offset = 0;
  for (let i = 0; i < nonIndexedInputPosition; i++) {
    offset += getBytesConsumedByParam(nonIndexedInputs[i]!);
  }

  if (params.length > 1) {
    const nestedOffset = getNestedParamOffset(
      nonIndexedInputs[nonIndexedInputPosition]! as TupleAbiParameter,
      params.slice(1),
    );

    offset += nestedOffset;
  }

  return {
    id: `log_${Array.isArray(address) ? address.join("_") : address}_${chainId}_offset${offset}_${eventSelector}_${fromBlock ?? "undefined"}_${toBlock ?? "undefined"}`,
    type: "log",
    chainId,
    sourceId,
    address,
    eventSelector,
    childAddressLocation: `offset${offset}`,
    fromBlock,
    toBlock,
  };
}
