import { Hex } from "viem";

const MAX_UINT =
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
  if (value < 0n) value = MAX_UINT + value;

  let hexString = value.toString(16);
  if (hexString.length > 64) {
    throw new Error(`Cannot convert bigint to buffer: ${value}`);
  }

  // Pad the hex string with leading zeros and add the sign byte.
  hexString = signByte + hexString.padStart(64, "0");

  // Return a Buffer from the padded hex string.
  return Buffer.from(hexString, "hex");
}

/**
 * Converts an encoded 33-byte Buffer (sign byte followed by 32-byte value) into a BigInt.
 * Used as the storage encoding for EVM uint256 and int256 types to enable ordering
 * using SQLite's default BLOB collation (memcmp).
 *
 * @param value Integer to be encoded.
 * @returns 33-byte Buffer representing the encoded integer.
 */
export function blobToBigInt(buffer: Buffer) {
  const signByte = buffer.at(0);
  const hexString = buffer.subarray(1).toString("hex").replace(/^0+/, "");
  if (hexString.length === 0) return 0n;

  let value = BigInt("0x" + hexString);

  // If the sign byte is negative, invert the value
  if (signByte === 0) {
    value = value - MAX_UINT;
  }

  return value;
}

/* This function merges intervals (inclusive on both ends).
 * I modified the SO impl to handle [inclusive, inclusive] intervals.
 * From: https://stackoverflow.com/a/26391774/12841788
 */
export function mergeIntervals(intervals: number[][]) {
  intervals.sort((a, b) => a[0] - b[0]);
  const result: number[][] = [];
  let last: number[];
  intervals.forEach((interval) => {
    if (interval[1] < interval[0])
      throw new Error(`Cannot merge invalid interval: ${interval}`);
    interval = [interval[0], interval[1] + 1];
    if (!last || interval[0] > last[1]) {
      result.push((last = interval));
    } else if (interval[1] > last[1]) {
      last[1] = interval[1];
    }
  });
  return result.map((r) => [r[0], r[1] - 1]);
}
