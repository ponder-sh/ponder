import { type Hex, numberToHex } from "viem";

type _JSONReplaceBigIntArr<
  arr extends readonly unknown[],
  type,
  result extends readonly unknown[] = [],
> = arr extends [infer first, ...infer rest]
  ? _JSONReplaceBigIntArr<
      rest,
      type,
      readonly [...result, first extends bigint ? type : first]
    >
  : result;

export type JSONReplaceBigInt<obj, type> = obj extends bigint
  ? type
  : obj extends unknown[]
    ? _JSONReplaceBigIntArr<Readonly<obj>, type>
    : obj extends readonly []
      ? _JSONReplaceBigIntArr<obj, type>
      : obj extends object
        ? { [key in keyof obj]: JSONReplaceBigInt<obj[key], type> }
        : obj;

export const jsonReplaceBigInt = <const T, const type>(
  obj: T,
  replacer: (x: bigint) => type,
): JSONReplaceBigInt<T, type> => {
  if (typeof obj === "bigint")
    return replacer(obj) as JSONReplaceBigInt<T, type>;
  if (Array.isArray(obj))
    return obj.map((x) => jsonReplaceBigInt(x, replacer)) as JSONReplaceBigInt<
      T,
      type
    >;
  if (obj && typeof obj === "object")
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, jsonReplaceBigInt(v, replacer)]),
    ) as JSONReplaceBigInt<T, type>;
  return obj as JSONReplaceBigInt<T, type>;
};

export type JSONReplaceBigIntToHex<T> = JSONReplaceBigInt<T, Hex>;
export const jsonReplaceBigIntToHex = <const T>(obj: T) =>
  jsonReplaceBigInt(obj, numberToHex);

export type JSONReplaceBigIntToString<T> = JSONReplaceBigInt<T, String>;
export const jsonReplaceBigIntToString = <const T>(obj: T) =>
  jsonReplaceBigInt(obj, String);

export type JSONReplaceBigIntToEncodedString<T> = JSONReplaceBigInt<T, String>;
export const jsonReplaceBigIntToEncodedString = <const T>(obj: T) =>
  jsonReplaceBigInt(obj, (x) => `#BigInt.${String(x)}`);
