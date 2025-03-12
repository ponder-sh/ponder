import type { AbiParameter } from "abitype";
import { InvalidAbiDecodingTypeError } from "viem";

// Adapted from viem.
// https://github.com/wagmi-dev/viem/blob/5c95fafceffe7f399b5b5ee32119e2d78a0c8acd/src/utils/abi/decodeEventLog.ts

export function getBytesConsumedByParam(param: AbiParameter): number {
  const arrayComponents = getArrayComponents(param);
  if (arrayComponents) {
    const { length, innerType } = arrayComponents;

    // If the array is dynamic or has dynamic children, it uses the
    // dynamic encoding scheme (32 byte header).
    if (!length || hasDynamicChild(param)) {
      return 32;
    }

    // If the length of the array is known in advance,
    // and the length of each element in the array is known,
    // the array data is encoded contiguously after the array.
    const bytesConsumedByInnerType = getBytesConsumedByParam(innerType);
    return length * bytesConsumedByInnerType;
  }

  if (param.type === "tuple") {
    // If the tuple has dynamic children, it uses the dynamic encoding
    // scheme (32 byte header).
    if (hasDynamicChild(param)) {
      return 32;
    }

    // Otherwise the tuple has static children, so we can just decode
    // each component in sequence.
    let consumed = 0;
    for (const component of (param as any).components ?? []) {
      consumed += getBytesConsumedByParam(component);
    }
    return consumed;
  }

  // Otherwise, it's a dynamic string or bytes (32 bytes),
  // or a static number, address, or bool (32 bytes).
  if (
    param.type === "string" ||
    param.type.startsWith("bytes") ||
    param.type.startsWith("uint") ||
    param.type.startsWith("int") ||
    param.type === "address" ||
    param.type === "bool"
  ) {
    return 32;
  }

  throw new InvalidAbiDecodingTypeError(param.type, {
    docsPath: "/docs/contract/decodeAbiParameters",
  });
}

function hasDynamicChild(param: AbiParameter) {
  const { type } = param;
  if (type === "string") return true;
  if (type === "bytes") return true;
  if (type.endsWith("[]")) return true;

  if (type === "tuple") return (param as any).components?.some(hasDynamicChild);

  const arrayComponents = getArrayComponents(param);
  if (arrayComponents && hasDynamicChild(arrayComponents.innerType))
    return true;

  return false;
}

function getArrayComponents(
  param: AbiParameter,
): { length: number | null; innerType: AbiParameter } | undefined {
  const matches = param.type.match(/^(.*)\[(\d+)?\]$/);
  if (!matches || !matches[1]) {
    return undefined;
  }
  // Return `null` length if the array is dynamic.
  const length = Number(matches?.[2]) || null;
  const innerType = { type: matches[1] };
  // If the array contains a tuple, include its components in innerType.
  if (innerType.type === "tuple") {
    Object.assign(innerType, { components: (param as any).components });
  }
  return { length, innerType };
}

export function computeNestedOffset(
  param: AbiParameter,
  pathSegments: string[],
): number {
  if (pathSegments.length === 0) {
    if (param.type !== "address") {
      throw new Error(
        `Factory event parameter is not an address. Got '${param.type}'.`,
      );
    }
    return 0;
  }

  const [currentSegment, ...restSegments] = pathSegments;

  const arrayComponents = getArrayComponents(param);

  // fixed length array
  if (arrayComponents?.length) {
    if (hasDynamicChild(param)) {
      throw new Error(
        "Factory event parameter must not be in a dynamic array.",
      );
    }
    const { length, innerType } = arrayComponents;
    const arrayIndex = Number.parseInt(currentSegment!);
    if (Number.isNaN(arrayIndex) || arrayIndex < 0 || arrayIndex >= length) {
      throw new Error(
        `Factory event parameter path contains invalid array index '${currentSegment}'. Array length is ${length}.`,
      );
    }
    let offset = arrayIndex * getBytesConsumedByParam(innerType);
    offset += computeNestedOffset(innerType, restSegments);
    return offset;
  }
  // tuple
  else if (param.type === "tuple" && "components" in param) {
    if (hasDynamicChild(param)) {
      throw new Error(
        "Factory event parameter must not be in a dynamic tuple.",
      );
    }
    const componentIndex = param.components.findIndex(
      (component) => component.name === currentSegment,
    );
    if (componentIndex === -1) {
      throw new Error(
        `Factory event parameter path contains invalid tuple field. Got '${currentSegment}', expected one of [${param.components
          .map((c) => `'${c.name}'`)
          .join(", ")}].`,
      );
    }
    let offset = 0;
    for (let i = 0; i < componentIndex; i++) {
      offset += getBytesConsumedByParam(param.components[i]!);
    }
    offset += computeNestedOffset(
      param.components[componentIndex]!,
      restSegments,
    );
    return offset;
  }
  // other types (nested path not supported)
  else {
    throw new Error(
      `Factory event parameter must be a static type. Got '${param.type}'.`,
    );
  }
}

// Converts from a2.b2[10].c2[1] to a2.b2.10.c2.1
export function convertToDotNotation(input: string): string {
  return input.replace(/\[(\d+)\]/g, ".$1");
}
