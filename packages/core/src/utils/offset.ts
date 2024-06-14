import type { AbiParameter } from "abitype";
import { InvalidAbiDecodingTypeError } from "viem";

// Adapted from viem.
// https://github.com/wagmi-dev/viem/blob/5c95fafceffe7f399b5b5ee32119e2d78a0c8acd/src/utils/abi/decodeEventLog.ts

export function getBytesConsumedByParam(param: AbiParameter): number {
  const arrayComponents = getArrayComponents(param.type);
  if (arrayComponents) {
    const [length, innerType] = arrayComponents;

    // If the array is dynamic or has dynamic children, it uses the
    // dynamic encoding scheme (32 byte header).
    if (!length || hasDynamicChild(param)) {
      return 32;
    }

    // If the length of the array is known in advance,
    // and the length of each element in the array is known,
    // the array data is encoded contiguously after the array.
    const bytesConsumedByInnerType = getBytesConsumedByParam({
      ...param,
      type: innerType,
    });
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

  const arrayComponents = getArrayComponents(param.type);
  if (
    arrayComponents &&
    hasDynamicChild({ ...param, type: arrayComponents[1] } as AbiParameter)
  )
    return true;

  return false;
}

function getArrayComponents(
  type: string,
): [length: number | null, innerType: string] | undefined {
  const matches = type.match(/^(.*)\[(\d+)?\]$/);
  return matches
    ? // Return `null` if the array is dynamic.
      [matches[2] ? Number(matches[2]) : null, matches[1]!]
    : undefined;
}
