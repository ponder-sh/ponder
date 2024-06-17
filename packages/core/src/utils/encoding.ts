import type { Hex } from "viem";

export const EVM_MAX_UINT =
  115792089237316195423570985008687907853269984665640564039457584007913129639935n;

export const EVM_MIN_INT =
  -57896044618658097711785492504343953926634992332820282019728792003956564819968n;

/**
 * Converts a integer into a 33-byte Buffer (sign byte followed by 32-byte value).
 * Used as the storage encoding for EVM uint256 and int256 types to enable ordering
 * using SQLite's default BLOB collation (memcmp).
 *
 * @param value Integer to be encoded.
 * @returns 33-byte Buffer representing the encoded integer.
 */
export function encodeAsText(value: bigint | number | Hex) {
  if (typeof value === "string" || typeof value === "number")
    value = BigInt(value);

  if (value > EVM_MAX_UINT)
    throw new Error(`Value cannot be greater than EVM_MAX_UINT (${value})`);
  if (value < EVM_MIN_INT)
    throw new Error(`Value cannot be less than EVM_MIN_INT (${value})`);

  const signChar = value >= 0n ? "0" : "-";

  // If the value is negative, add the minimum integer to it.
  if (value < 0n) value = value - EVM_MIN_INT;

  const chars = value.toString(10);

  // Pad the hex string with leading zeros and add the sign byte.
  return signChar + chars.padStart(78, "0");
}

/**
 * Converts an encoded 33-byte Buffer (sign byte followed by 32-byte value) into a BigInt.
 * Used as the storage encoding for EVM uint256 and int256 types to enable ordering
 * using SQLite's default BLOB collation (memcmp).
 *
 * @param value Integer to be encoded.
 * @returns 33-byte Buffer representing the encoded integer.
 */
export function decodeToBigInt(text: string) {
  if (typeof text === "bigint") return text;

  const signChar = text.at(0);
  let valueChars = text.substring(1).replace(/^0+/, "");
  // If the value is 0, valueChars will be an empty string.
  if (valueChars.length === 0) valueChars = "0";
  let value = BigInt(valueChars);

  // If the sign byte is negative, invert the value

  if (signChar === "-") value = value + EVM_MIN_INT;

  return value;
}
