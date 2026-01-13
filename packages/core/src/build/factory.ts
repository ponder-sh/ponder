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

type ParameterLocation = "topic1" | "topic2" | "topic3" | `offset${number}`;

/**
 * Computes the location of a parameter in the event log data.
 * Returns the topic index (for indexed params) or byte offset (for non-indexed params).
 */
function getParameterLocation(
  event: AbiEvent,
  parameter: string,
  expectedType?: string,
): ParameterLocation {
  const params = parameter.split(".");

  // Check if the provided parameter is present in the list of indexed inputs.
  const indexedInputPosition = event.inputs
    .filter((x) => "indexed" in x && x.indexed)
    .findIndex((input) => input.name === params[0]);

  if (indexedInputPosition > -1 && params.length === 1) {
    return `topic${(indexedInputPosition + 1) as 1 | 2 | 3}`;
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

  if (
    expectedType &&
    nonIndexedParameter.type !== expectedType &&
    params.length === 1
  ) {
    throw new Error(
      `Factory event parameter type is not valid. Got '${nonIndexedParameter.type}', expected '${expectedType}'.`,
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

  return `offset${offset}`;
}

export function buildLogFactory({
  address: _address,
  event,
  parameter,
  chainId,
  sourceId,
  fromBlock,
  toBlock,
  childStartBlock,
  startBlockParameter,
}: {
  address?: Address | readonly Address[];
  event: AbiEvent;
  parameter: string;
  chainId: number;
  sourceId: string;
  fromBlock: number | undefined;
  toBlock: number | undefined;
  childStartBlock?: number;
  startBlockParameter?: string;
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

  // Get the location of the child address parameter
  const childAddressLocation = getParameterLocation(
    event,
    parameter,
    "address",
  );

  // Get the location of the start block parameter if specified
  let childStartBlockLocation: ParameterLocation | undefined;
  if (startBlockParameter) {
    // For start block, we accept uint256 or similar numeric types
    // We don't enforce a specific type since it could be uint256, uint64, etc.
    childStartBlockLocation = getParameterLocation(event, startBlockParameter);
  }

  const id = `log_${Array.isArray(address) ? address.join("_") : address}_${chainId}_${childAddressLocation}_${eventSelector}_${fromBlock ?? "undefined"}_${toBlock ?? "undefined"}`;

  return {
    id,
    type: "log",
    chainId,
    sourceId,
    address,
    eventSelector,
    childAddressLocation,
    fromBlock,
    toBlock,
    childStartBlock,
    childStartBlockLocation,
  };
}
