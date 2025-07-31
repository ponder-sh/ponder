import {
  AbiDecodingDataSizeTooSmallError,
  AbiDecodingZeroDataError,
  type AbiParameter,
  type DecodeAbiParametersReturnType,
  type Hex,
  InvalidAbiDecodingTypeError,
  hexToBigInt,
  hexToBool,
  hexToNumber,
  hexToString,
  size,
  trim,
} from "viem";
import { type Cursor, createCursor, readBytes, setPosition } from "./cursor.js";

export function decodeAbiParameters<
  const params extends readonly AbiParameter[],
>(params: params, data: Hex): DecodeAbiParametersReturnType<params> {
  if (size(data) === 0 && params.length > 0)
    throw new AbiDecodingZeroDataError();
  if (size(data) && size(data) < 32)
    throw new AbiDecodingDataSizeTooSmallError({
      data,
      params: params as readonly AbiParameter[],
      size: size(data),
    });

  const cursor = createCursor(data);

  let consumed = 0;
  const values = [];
  for (let i = 0; i < params.length; ++i) {
    const param = params[i]!;
    setPosition(cursor, consumed);
    const [data, consumed_] = decodeParameter(cursor, param, {
      staticPosition: 0,
    });
    consumed += consumed_;
    values.push(data);
  }
  return values as DecodeAbiParametersReturnType<params>;
}

function decodeParameter(
  cursor: Cursor,
  param: AbiParameter,
  { staticPosition }: { staticPosition: number },
) {
  const arrayComponents = getArrayComponents(param.type);
  if (arrayComponents) {
    const [length, type] = arrayComponents;
    return decodeArray(cursor, { ...param, type }, { length, staticPosition });
  }
  if (param.type === "tuple")
    return decodeTuple(cursor, param as TupleAbiParameter, { staticPosition });

  if (param.type === "address") return decodeAddress(cursor);
  if (param.type === "bool") return decodeBool(cursor);
  if (param.type.startsWith("bytes"))
    return decodeBytes(cursor, param, { staticPosition });
  if (param.type.startsWith("uint") || param.type.startsWith("int"))
    return decodeNumber(cursor, param);
  if (param.type === "string") return decodeString(cursor, { staticPosition });
  throw new InvalidAbiDecodingTypeError(param.type, {
    docsPath: "/docs/contract/decodeAbiParameters",
  });
}

export function getArrayComponents(
  type: string,
): [length: number | null, innerType: string] | undefined {
  const matches = type.match(/^(.*)\[(\d+)?\]$/);
  return matches
    ? // Return `null` if the array is dynamic.
      [matches[2] ? Number(matches[2]) : null, matches[1]!]
    : undefined;
}

////////////////////////////////////////////////////////////////////
// Type Decoders

const sizeOfLength = 32;
const sizeOfOffset = 32;

function decodeAddress(cursor: Cursor) {
  const value = readBytes(cursor, 32);

  return [`0x${value.slice(-40)}`, 32];
}

function decodeArray(
  cursor: Cursor,
  param: AbiParameter,
  { length, staticPosition }: { length: number | null; staticPosition: number },
) {
  // If the length of the array is not known in advance (dynamic array),
  // this means we will need to wonder off to the pointer and decode.
  if (!length) {
    // Dealing with a dynamic type, so get the offset of the array data.

    const offset = hexToNumber(readBytes(cursor, sizeOfOffset));
    //const offset = bytesToNumber(cursor.readBytes(sizeOfOffset));

    // Start is the static position of current slot + offset.
    const start = staticPosition + offset;
    const startOfData = start + sizeOfLength;

    // Get the length of the array from the offset.
    setPosition(cursor, start);
    const length = hexToNumber(readBytes(cursor, sizeOfLength));
    //const length = bytesToNumber(cursor.readBytes(sizeOfLength));

    // Check if the array has any dynamic children.
    const dynamicChild = hasDynamicChild(param);

    let consumed = 0;
    const value: unknown[] = [];
    for (let i = 0; i < length; ++i) {
      // If any of the children is dynamic, then all elements will be offset pointer, thus size of one slot (32 bytes).
      // Otherwise, elements will be the size of their encoding (consumed bytes).
      setPosition(cursor, startOfData + (dynamicChild ? i * 32 : consumed));
      const [data, consumed_] = decodeParameter(cursor, param, {
        staticPosition: startOfData,
      });
      consumed += consumed_;
      value.push(data);
    }

    // As we have gone wondering, restore to the original position + next slot.
    setPosition(cursor, staticPosition + 32);
    return [value, 32];
  }

  // If the length of the array is known in advance,
  // and the length of an element deeply nested in the array is not known,
  // we need to decode the offset of the array data.
  if (hasDynamicChild(param)) {
    // Dealing with dynamic types, so get the offset of the array data.
    const offset = hexToNumber(readBytes(cursor, sizeOfOffset));
    //const offset = bytesToNumber(cursor.readBytes(sizeOfOffset));

    // Start is the static position of current slot + offset.
    const start = staticPosition + offset;

    const value: unknown[] = [];
    for (let i = 0; i < length; ++i) {
      // Move cursor along to the next slot (next offset pointer).
      setPosition(cursor, start + i * 32);
      const [data] = decodeParameter(cursor, param, {
        staticPosition: start,
      });
      value.push(data);
    }

    // As we have gone wondering, restore to the original position + next slot.
    setPosition(cursor, staticPosition + 32);
    return [value, 32];
  }

  // If the length of the array is known in advance and the array is deeply static,
  // then we can just decode each element in sequence.
  let consumed = 0;
  const value: unknown[] = [];
  for (let i = 0; i < length; ++i) {
    const [data, consumed_] = decodeParameter(cursor, param, {
      staticPosition: staticPosition + consumed,
    });
    consumed += consumed_;
    value.push(data);
  }
  return [value, consumed];
}

function decodeBool(cursor: Cursor) {
  return [hexToBool(readBytes(cursor, 32), { size: 32 }), 32];
}

function decodeBytes(
  cursor: Cursor,
  param: AbiParameter,
  { staticPosition }: { staticPosition: number },
) {
  const [_, size] = param.type.split("bytes");
  if (!size) {
    // Dealing with dynamic types, so get the offset of the bytes data.
    const offset = hexToNumber(readBytes(cursor, 32));
    // const offset = bytesToNumber(cursor.readBytes(32));

    // Set position of the cursor to start of bytes data.
    setPosition(cursor, staticPosition + offset);

    const length = hexToNumber(readBytes(cursor, 32));
    // const length = bytesToNumber(cursor.readBytes(32));

    // If there is no length, we have zero data.
    if (length === 0) {
      // As we have gone wondering, restore to the original position + next slot.
      setPosition(cursor, staticPosition + 32);
      return ["0x", 32];
    }

    const data = readBytes(cursor, length);

    // As we have gone wondering, restore to the original position + next slot.
    setPosition(cursor, staticPosition + 32);
    return [data, 32];
  }

  const value = readBytes(cursor, Number.parseInt(size), 32);
  return [value, 32];
}

function decodeNumber(cursor: Cursor, param: AbiParameter) {
  const signed = param.type.startsWith("int");
  const size = Number.parseInt(param.type.split("int")[1] || "256");
  const value = readBytes(cursor, 32);
  return [
    size > 48 ? hexToBigInt(value, { signed }) : hexToNumber(value, { signed }),
    32,
  ];
}

type TupleAbiParameter = AbiParameter & { components: readonly AbiParameter[] };

function decodeTuple(
  cursor: Cursor,
  param: TupleAbiParameter,
  { staticPosition }: { staticPosition: number },
) {
  // Tuples can have unnamed components (i.e. they are arrays), so we must
  // determine whether the tuple is named or unnamed. In the case of a named
  // tuple, the value will be an object where each property is the name of the
  // component. In the case of an unnamed tuple, the value will be an array.
  const hasUnnamedChild =
    param.components.length === 0 || param.components.some(({ name }) => !name);

  // Initialize the value to an object or an array, depending on whether the
  // tuple is named or unnamed.
  const value: any = hasUnnamedChild ? [] : {};
  let consumed = 0;

  // If the tuple has a dynamic child, we must first decode the offset to the
  // tuple data.
  if (hasDynamicChild(param)) {
    // Dealing with dynamic types, so get the offset of the tuple data.
    const offset = hexToNumber(readBytes(cursor, sizeOfOffset));
    // const offset = bytesToNumber(cursor.readBytes(sizeOfOffset));

    // Start is the static position of referencing slot + offset.
    const start = staticPosition + offset;

    for (let i = 0; i < param.components.length; ++i) {
      const component = param.components[i]!;
      setPosition(cursor, start + consumed);
      const [data, consumed_] = decodeParameter(cursor, component, {
        staticPosition: start,
      });
      consumed += consumed_;
      value[hasUnnamedChild ? i : component?.name!] = data;
    }

    // As we have gone wondering, restore to the original position + next slot.
    setPosition(cursor, staticPosition + 32);
    return [value, 32];
  }

  // If the tuple has static children, we can just decode each component
  // in sequence.
  for (let i = 0; i < param.components.length; ++i) {
    const component = param.components[i]!;
    const [data, consumed_] = decodeParameter(cursor, component, {
      staticPosition,
    });
    value[hasUnnamedChild ? i : component?.name!] = data;
    consumed += consumed_;
  }
  return [value, consumed];
}

function decodeString(
  cursor: Cursor,
  { staticPosition }: { staticPosition: number },
) {
  // Get offset to start of string data.
  const offset = hexToNumber(readBytes(cursor, 32));
  // const offset = bytesToNumber(cursor.readBytes(32));

  // Start is the static position of current slot + offset.
  const start = staticPosition + offset;
  setPosition(cursor, start);

  const length = hexToNumber(readBytes(cursor, 32));
  // const length = bytesToNumber(cursor.readBytes(32));

  // If there is no length, we have zero data (empty string).
  if (length === 0) {
    setPosition(cursor, staticPosition + 32);
    return ["", 32];
  }

  const data = readBytes(cursor, length, 32);
  const value = hexToString(trim(data));

  // As we have gone wondering, restore to the original position + next slot.
  setPosition(cursor, staticPosition + 32);

  return [value, 32];
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
