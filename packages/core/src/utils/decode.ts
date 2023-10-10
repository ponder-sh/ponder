const EVM_MAX_UINT =
  115792089237316195423570985008687907853269984665640564039457584007913129639935n;

/**
 * Converts an encoded 33-byte Buffer (sign byte followed by 32-byte value) into a BigInt.
 * Used as the storage encoding for EVM uint256 and int256 types to enable ordering
 * using SQLite's default BLOB collation (memcmp).
 *
 * @param value Integer to be encoded.
 * @returns 33-byte Buffer representing the encoded integer.
 */
export function blobToBigInt(buffer: Buffer | bigint) {
  if (typeof buffer === "bigint") return buffer;

  const signByte = buffer.at(0);
  const hexString = buffer.subarray(1).toString("hex").replace(/^0+/, "");
  if (hexString.length === 0) return 0n;

  let value = BigInt("0x" + hexString);

  // If the sign byte is negative, invert the value
  if (signByte === 0) {
    value = value - EVM_MAX_UINT;
  }

  return value;
}
