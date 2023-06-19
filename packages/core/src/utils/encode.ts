import type { Hex } from "viem";

const EVM_MAX_UINT =
  115792089237316195423570985008687907853269984665640564039457584007913129639935n;
/**
 * Converts a integer into a 33-byte Buffer (sign byte followed by 32-byte value).
 * Used as the storage encoding for EVM uint256 and int256 types to enable ordering
 * using SQLite's default BLOB collation (memcmp).
 *
 * @param value Integer to be encoded.
 * @returns 33-byte Buffer representing the encoded integer.
 */
export function intToBlob(value: bigint | number | Hex) {
  if (typeof value === "string" || typeof value === "number")
    value = BigInt(value);

  // If the value is negative, invert it.
  const signByte = value >= 0n ? "ff" : "00";
  if (value < 0n) value = EVM_MAX_UINT + value;

  let hexString = value.toString(16);
  if (hexString.length > 64) {
    throw new Error(
      `Value exceeds the EVM_MAX_UINT size (32 byte unsigned integer): ${value}`
    );
  }

  // Pad the hex string with leading zeros and add the sign byte.
  hexString = signByte + hexString.padStart(64, "0");

  // Return a Buffer from the padded hex string.
  return Buffer.from(hexString, "hex");
}
