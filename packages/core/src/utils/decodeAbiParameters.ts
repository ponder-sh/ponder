import {
  AbiDecodingZeroDataError,
  type AbiParameter,
  type AbiParameterToPrimitiveType,
  type DecodeAbiParametersReturnType,
  type Hex,
  checksumAddress,
  hexToBigInt,
  hexToNumber,
  hexToString,
} from "viem";

const TRUE_BOOL =
  "0x0000000000000000000000000000000000000000000000000000000000000001" as const;
const FIXED_ARRAY_REGEX = /^(.*)\[(\d+)\]$/;
const DYNAMIC_ARRAY_REGEX = /^(.*)\[\]$/;

const cursor = { index: 2, offset: 2, length: 0 };

function readWord(data: Hex): Hex {
  if (data.length - cursor.index < 64) {
    throw new Error("Invalid data length.");
  }

  return `0x${data.slice(cursor.index, cursor.index + 64)}` as const;
}

/**
 * Decode a list of abi parameters.
 *
 * @see https://github.com/wevm/viem/blob/38525bf1d55ec3fe0569e47700c7f9e70d3c971c/src/utils/abi/decodeAbiParameters.ts
 */
export function decodeAbiParameters<
  const params extends readonly AbiParameter[],
>(
  params: params,
  data: Hex,
  {
    formatAddress = checksumAddress,
    out = [] as DecodeAbiParametersReturnType<params>,
  }: {
    formatAddress?: (address: Hex) => Hex;
    out?: DecodeAbiParametersReturnType<params>;
  } = {
    formatAddress: checksumAddress,
    out: [] as DecodeAbiParametersReturnType<params>,
  },
): DecodeAbiParametersReturnType<params> {
  if (data.length <= 2 && params.length > 0) {
    throw new AbiDecodingZeroDataError();
  }

  cursor.index = 2;
  cursor.offset = 2;
  cursor.length = data.length;

  for (const param of params) {
    if (data.length - cursor.index < 64) {
      throw new Error("Invalid data length.");
    }

    (out as unknown[]).push(_decodeAbiParameter(param, data, formatAddress));
  }

  return out;
}

function _decodeAbiParameter(
  param: AbiParameter,
  data: Hex,
  formatAddress: (address: Hex) => Hex = checksumAddress,
): unknown {
  if (isAbiParameterFixedArray(param)) {
    const _type = param.type;
    const [_, type, length] = param.type.match(FIXED_ARRAY_REGEX)!;
    param.type = type!;

    if (isAbiParameterDeeplyStatic(param) === false) {
      const _offset = cursor.offset;
      const _index = cursor.index;

      const offset = readWord(data);

      cursor.index = cursor.offset + hexToNumber(offset) * 2;
      cursor.offset += hexToNumber(offset) * 2;

      const value: unknown[] = [];
      for (let i = 0; i < Number.parseInt(length!, 10); ++i) {
        cursor.index = cursor.offset + i * 64;

        value.push(_decodeAbiParameter(param, data, formatAddress));
      }

      cursor.offset = _offset;
      cursor.index = _index + 64;
      param.type = _type;

      return value;
    }

    const value: unknown[] = [];
    for (let i = 0; i < Number.parseInt(length!, 10); ++i) {
      value.push(_decodeAbiParameter(param, data, formatAddress));
    }

    param.type = _type;
    return value;
  }

  if (isAbiParameterDynamicArray(param)) {
    const _offset = cursor.offset;
    const _index = cursor.index;

    const offset = readWord(data);

    cursor.index = cursor.offset + hexToNumber(offset) * 2;
    cursor.offset += hexToNumber(offset) * 2 + 64;

    const length = readWord(data);
    cursor.index += 64;

    const _type = param.type;
    const [_, type] = param.type.match(DYNAMIC_ARRAY_REGEX)!;
    param.type = type!;

    const deeplyStatic = isAbiParameterDeeplyStatic(param);

    const value: unknown[] = [];
    for (let i = 0; i < hexToNumber(length!); ++i) {
      if (deeplyStatic === false) {
        cursor.index = cursor.offset + i * 64;
      }

      value.push(_decodeAbiParameter(param, data, formatAddress));
    }

    cursor.offset = _offset;
    cursor.index = _index + 64;
    param.type = _type;

    return value;
  }

  if (param.type === "tuple") {
    const components = (
      param as Extract<AbiParameter, { components: readonly AbiParameter[] }>
    ).components;

    const hasUnnamedChild =
      components.length === 0 ||
      components.some((component) => component.name === undefined);

    const value: any = hasUnnamedChild ? [] : {};

    if (isAbiParameterDeeplyStatic(param)) {
      for (let i = 0; i < components.length; ++i) {
        const component = components[i]!;
        const _value = _decodeAbiParameter(component, data, formatAddress);

        if (hasUnnamedChild) {
          value.push(_value);
        } else {
          value[component.name!] = _value;
        }
      }

      return value;
    }

    const _offset = cursor.offset;
    const _index = cursor.index;
    const offset = readWord(data);
    cursor.offset += hexToNumber(offset) * 2;
    cursor.index = cursor.offset;

    for (let i = 0; i < components.length; ++i) {
      const component = components[i]!;
      const _value = _decodeAbiParameter(component, data, formatAddress);

      if (hasUnnamedChild) {
        value.push(_value);
      } else {
        value[component.name!] = _value;
      }
    }

    cursor.offset = _offset;
    cursor.index = _index + 64;

    return value;
  }

  if (param.type === "address") {
    // TODO(kyle) check data length
    const address =
      `0x${data.slice(cursor.index + 24, cursor.index + 64)}` as const;
    cursor.index += 64;
    return formatAddress(address);
  }

  if (param.type.startsWith("uint") || param.type.startsWith("int")) {
    const signed = param.type.startsWith("int");
    const size = Number.parseInt(param.type.split("int")[1] || "256", 10);
    const value = readWord(data);
    cursor.index += 64;

    return size > 48
      ? hexToBigInt(value, { signed })
      : hexToNumber(value, { signed });
  }

  if (param.type.startsWith("bytes") && param.type.length > 5) {
    const [_, size] = param.type.split("bytes");
    // TODO(kyle) check data length
    const value =
      `0x${data.slice(cursor.index, cursor.index + Number.parseInt(size!, 10) * 2)}` as const;

    cursor.index += 64;
    return value;
  }

  if (param.type === "bool") {
    const value = readWord(data);
    cursor.index += 64;
    return value === TRUE_BOOL;
  }

  if (param.type === "string") {
    const _index = cursor.index;

    const offset = readWord(data);
    cursor.index = cursor.offset + hexToNumber(offset) * 2;
    const length = readWord(data);
    cursor.index += 64;

    if (hexToNumber(length) === 0) {
      cursor.index = _index + 64;
      return "";
    }

    // TODO(kyle) check data length
    const value =
      `0x${data.slice(cursor.index, cursor.index + hexToNumber(length) * 2)}` as const;

    cursor.index = _index + 64;

    return hexToString(value);
  }

  if (param.type === "bytes") {
    const index = cursor.index;

    const offset = readWord(data);
    cursor.index = cursor.offset + hexToNumber(offset) * 2;

    const length = readWord(data);
    cursor.index += 64;

    if (hexToNumber(length) === 0) {
      cursor.index = index + 64;
      return "0x";
    }

    // TODO(kyle) check data length
    const value =
      `0x${data.slice(cursor.index, cursor.index + hexToNumber(length) * 2)}` as const;

    cursor.index = index + 64;

    return value;
  }

  throw new Error(`Invalid parameter type: ${param.type}`);
}

/**
 * Decode a single abi parameter.
 *
 * @see https://github.com/wevm/viem/blob/38525bf1d55ec3fe0569e47700c7f9e70d3c971c/src/utils/abi/decodeAbiParameters.ts
 */
export function decodeAbiParameter<const param extends AbiParameter>(
  param: param,
  data: Hex,
  {
    formatAddress = checksumAddress,
  }: {
    formatAddress?: (address: Hex) => Hex;
  } = {
    formatAddress: checksumAddress,
  },
): AbiParameterToPrimitiveType<param> {
  if (data.length <= 2) {
    throw new AbiDecodingZeroDataError();
  }

  if (data.length !== 66) {
    throw new Error(
      `Invalid data length. Expected 66 bytes, got ${data.length}`,
    );
  }

  if (param.type === "address") {
    const address = `0x${data.slice(2 + 12 * 2)}` as const;
    return formatAddress(address) as AbiParameterToPrimitiveType<param>;
  }

  if (param.type.startsWith("uint") || param.type.startsWith("int")) {
    const signed = param.type.startsWith("int");
    const size = Number.parseInt(param.type.split("int")[1] || "256", 10);

    return (
      size > 48 ? hexToBigInt(data, { signed }) : hexToNumber(data, { signed })
    ) as AbiParameterToPrimitiveType<param>;
  }

  if (param.type.startsWith("bytes") && param.type.length > 5) {
    const [_, size] = param.type.split("bytes");
    return data.slice(
      0,
      2 + Number.parseInt(size!, 10) * 2,
    ) as AbiParameterToPrimitiveType<param>;
  }

  if (param.type === "bool") {
    return (data === TRUE_BOOL) as AbiParameterToPrimitiveType<param>;
  }

  throw new Error(`Invalid parameter type: ${param.type}`);
}

function isAbiParameterFixedArray(param: AbiParameter) {
  return FIXED_ARRAY_REGEX.test(param.type);
}

function isAbiParameterDynamicArray(param: AbiParameter) {
  return DYNAMIC_ARRAY_REGEX.test(param.type);
}

function isAbiParameterDeeplyStatic(param: AbiParameter): boolean {
  const { type } = param;

  if (type === "string") return false;
  if (type === "bytes") return false;
  if (type.endsWith("[]")) return false;

  if (type === "tuple") {
    return (
      param as Extract<AbiParameter, { components: readonly AbiParameter[] }>
    ).components.every(isAbiParameterDeeplyStatic);
  }

  if (isAbiParameterFixedArray(param)) {
    const _type = param.type;
    const [_, type] = param.type.match(FIXED_ARRAY_REGEX)!;
    param.type = type!;

    const result = isAbiParameterDeeplyStatic(param);

    param.type = _type;
    return result;
  }

  if (isAbiParameterDynamicArray(param)) {
    const _type = param.type;
    const [_, type] = param.type.match(DYNAMIC_ARRAY_REGEX)!;
    param.type = type!;

    const result = isAbiParameterDeeplyStatic(param);

    param.type = _type;
    return result;
  }

  return true;
}
