import { ByteArray, Bytes } from './collections'
import { typeConversion } from './conversion'

/** Host interface for BigInt arithmetic */
export declare namespace bigInt {
  function plus(x: bigint, y: bigint): bigint
  function minus(x: bigint, y: bigint): bigint
  function times(x: bigint, y: bigint): bigint
  function dividedBy(x: bigint, y: bigint): bigint
  function dividedByDecimal(x: bigint, y: BigDecimal): BigDecimal
  function mod(x: bigint, y: bigint): bigint
  function pow(x: bigint, exp: u8): bigint
  function fromString(s: string): bigint
  function bitOr(x: bigint, y: bigint): bigint
  function bitAnd(x: bigint, y: bigint): bigint
  function leftShift(x: bigint, bits: u8): bigint
  function rightShift(x: bigint, bits: u8): bigint
}

/** Host interface for BigDecimal */
export declare namespace bigDecimal {
  function plus(x: BigDecimal, y: BigDecimal): BigDecimal
  function minus(x: BigDecimal, y: BigDecimal): BigDecimal
  function times(x: BigDecimal, y: BigDecimal): BigDecimal
  function dividedBy(x: BigDecimal, y: BigDecimal): BigDecimal
  function equals(x: BigDecimal, y: BigDecimal): boolean
  function toString(bigDecimal: BigDecimal): string
  function fromString(s: string): BigDecimal
}

/** An Ethereum address (20 bytes). */
export class Address extends Bytes {
  static fromString(s: string): Address {
    return changetype<Address>(typeConversion.stringToH160(s))
  }

  /** Convert `Bytes` that must be exactly 20 bytes long to an address.
   * Passing in a value with fewer or more bytes will result in an error */
  static fromBytes(b: Bytes): Address {
    if (b.length != 20) {
      throw new Error(
        `Bytes of length ${b.length} can not be converted to 20 byte addresses`,
      )
    }
    return changetype<Address>(b)
  }

  static zero(): Address {
    const self = new ByteArray(20)

    for (let i = 0; i < 20; i++) {
      self[i] = 0
    }

    return changetype<Address>(self)
  }
}

/** An arbitrary size integer represented as an array of bytes. */
export class BigInt extends Uint8Array {
  static fromI32(x: i32): bigint {
    const byteArray = ByteArray.fromI32(x)
    return BigInt.fromByteArray(byteArray)
  }

  static fromU32(x: u32): bigint {
    const byteArray = ByteArray.fromU32(x)
    return BigInt.fromUnsignedBytes(byteArray)
  }

  static fromI64(x: i64): bigint {
    const byteArray = ByteArray.fromI64(x)
    return BigInt.fromByteArray(byteArray)
  }

  static fromU64(x: u64): bigint {
    const byteArray = ByteArray.fromU64(x)
    return BigInt.fromUnsignedBytes(byteArray)
  }

  static zero(): bigint {
    return BigInt.fromI32(0)
  }

  /**
   * `bytes` assumed to be little-endian. If your input is big-endian, call `.reverse()` first.
   */

  static fromSignedBytes(bytes: Bytes): bigint {
    const byteArray = <ByteArray>bytes
    return BigInt.fromByteArray(byteArray)
  }

  static fromByteArray(byteArray: ByteArray): bigint {
    return changetype<bigint>(byteArray)
  }

  /**
   * `bytes` assumed to be little-endian. If your input is big-endian, call `.reverse()` first.
   */

  static fromUnsignedBytes(bytes: ByteArray): bigint {
    const signedBytes = new BigInt(bytes.length + 1)
    for (let i = 0; i < bytes.length; i++) {
      signedBytes[i] = bytes[i]
    }
    signedBytes[bytes.length] = 0
    return signedBytes
  }

  toHex(): string {
    return typeConversion.bigIntToHex(this)
  }

  toHexString(): string {
    return typeConversion.bigIntToHex(this)
  }

  toString(): string {
    return typeConversion.bigIntToString(this)
  }

  static fromString(s: string): bigint {
    return bigInt.fromString(s)
  }

  toI32(): i32 {
    const uint8Array = changetype<Uint8Array>(this)
    const byteArray = changetype<ByteArray>(uint8Array)
    return byteArray.toI32()
  }

  toU32(): u32 {
    const uint8Array = changetype<Uint8Array>(this)
    const byteArray = changetype<ByteArray>(uint8Array)
    return byteArray.toU32()
  }

  toI64(): i64 {
    const uint8Array = changetype<Uint8Array>(this)
    const byteArray = changetype<ByteArray>(uint8Array)
    return byteArray.toI64()
  }

  toU64(): u64 {
    const uint8Array = changetype<Uint8Array>(this)
    const byteArray = changetype<ByteArray>(uint8Array)
    return byteArray.toU64()
  }

  toBigDecimal(): BigDecimal {
    return new BigDecimal(this)
  }

  isZero(): boolean {
    return this == BigInt.fromI32(0)
  }

  isI32(): boolean {
    return BigInt.fromI32(i32.MIN_VALUE) <= this && this <= BigInt.fromI32(i32.MAX_VALUE)
  }

  abs(): bigint {
    return this < BigInt.fromI32(0) ? this.neg() : this
  }

  sqrt(): bigint {
    const x: bigint = this
    let z = x.plus(BigInt.fromI32(1)).div(BigInt.fromI32(2))
    let y = x
    while (z < y) {
      y = z
      z = x.div(z).plus(z).div(BigInt.fromI32(2))
    }

    return y
  }

  // Operators

  plus(other: bigint): bigint {
    assert(this !== null, "Failed to sum BigInts because left hand side is 'null'")
    return bigInt.plus(this, other)
  }

  minus(other: bigint): bigint {
    assert(this !== null, "Failed to subtract BigInts because left hand side is 'null'")
    return bigInt.minus(this, other)
  }

  times(other: bigint): bigint {
    assert(this !== null, "Failed to multiply BigInts because left hand side is 'null'")
    return bigInt.times(this, other)
  }

  div(other: bigint): bigint {
    assert(this !== null, "Failed to divide BigInts because left hand side is 'null'")
    return bigInt.dividedBy(this, other)
  }

  divDecimal(other: BigDecimal): BigDecimal {
    return bigInt.dividedByDecimal(this, other)
  }

  mod(other: bigint): bigint {
    assert(
      this !== null,
      "Failed to apply module to BigInt because left hand side is 'null'",
    )
    return bigInt.mod(this, other)
  }

  equals(other: bigint): boolean {
    return BigInt.compare(this, other) == 0
  }

  notEqual(other: bigint): boolean {
    return !(this == other)
  }

  lt(other: bigint): boolean {
    return BigInt.compare(this, other) == -1
  }

  gt(other: bigint): boolean {
    return BigInt.compare(this, other) == 1
  }

  le(other: bigint): boolean {
    return !(this > other)
  }

  ge(other: bigint): boolean {
    return !(this < other)
  }

  neg(): bigint {
    return BigInt.fromI32(0).minus(this)
  }

  bitOr(other: bigint): bigint {
    return bigInt.bitOr(this, other)
  }

  bitAnd(other: bigint): bigint {
    return bigInt.bitAnd(this, other)
  }

  leftShift(bits: u8): bigint {
    return bigInt.leftShift(this, bits)
  }

  rightShift(bits: u8): bigint {
    return bigInt.rightShift(this, bits)
  }

  /// Limited to a low exponent to discourage creating a huge BigInt.
  pow(exp: u8): bigint {
    return bigInt.pow(this, exp)
  }

  /**
   * Returns −1 if a < b, 1 if a > b, and 0 if A == B
   */
  static compare(a: bigint, b: bigint): i32 {
    // Check if a and b have the same sign.
    const aIsNeg = a.length > 0 && a[a.length - 1] >> 7 == 1
    const bIsNeg = b.length > 0 && b[b.length - 1] >> 7 == 1

    if (!aIsNeg && bIsNeg) {
      return 1
    } else if (aIsNeg && !bIsNeg) {
      return -1
    }

    // Check how many bytes of a and b are relevant to the magnitude.
    let aRelevantBytes = a.length
    while (
      aRelevantBytes > 0 &&
      ((!aIsNeg && a[aRelevantBytes - 1] == 0) ||
        (aIsNeg && a[aRelevantBytes - 1] == 255))
    ) {
      aRelevantBytes -= 1
    }
    let bRelevantBytes = b.length
    while (
      bRelevantBytes > 0 &&
      ((!bIsNeg && b[bRelevantBytes - 1] == 0) ||
        (bIsNeg && b[bRelevantBytes - 1] == 255))
    ) {
      bRelevantBytes -= 1
    }

    // If a and b are positive then the one with more relevant bytes is larger.
    // Otherwise the one with less relevant bytes is larger.
    if (aRelevantBytes > bRelevantBytes) {
      return aIsNeg ? -1 : 1
    } else if (bRelevantBytes > aRelevantBytes) {
      return aIsNeg ? 1 : -1
    }

    // We now know that a and b have the same sign and number of relevant bytes.
    // If a and b are both negative then the one of lesser magnitude is the
    // largest, however since in two's complement the magnitude is flipped, we
    // may use the same logic as if a and b are positive.
    const relevantBytes = aRelevantBytes
    for (let i = 1; i <= relevantBytes; i++) {
      if (a[relevantBytes - i] < b[relevantBytes - i]) {
        return -1
      } else if (a[relevantBytes - i] > b[relevantBytes - i]) {
        return 1
      }
    }

    return 0
  }
}

export class BigDecimal {
  digits: bigint
  exp: bigint

  constructor(bigInt: bigint) {
    this.digits = bigInt
    this.exp = BigInt.fromI32(0)
  }

  static fromString(s: string): BigDecimal {
    return bigDecimal.fromString(s)
  }

  static zero(): BigDecimal {
    return new BigDecimal(BigInt.zero())
  }

  toString(): string {
    return bigDecimal.toString(this)
  }

  truncate(decimals: i32): BigDecimal {
    const digitsRightOfZero = this.digits.toString().length + this.exp.toI32()
    const newDigitLength = decimals + digitsRightOfZero
    const truncateLength = this.digits.toString().length - newDigitLength
    if (truncateLength < 0) {
      return this
    } else {
      for (let i = 0; i < truncateLength; i++) {
        this.digits = this.digits.div(BigInt.fromI32(10))
      }
      this.exp = BigInt.fromI32(decimals * -1)
      return this
    }
  }

  plus(other: BigDecimal): BigDecimal {
    assert(this !== null, "Failed to sum BigDecimals because left hand side is 'null'")
    return bigDecimal.plus(this, other)
  }

  minus(other: BigDecimal): BigDecimal {
    assert(
      this !== null,
      "Failed to subtract BigDecimals because left hand side is 'null'",
    )
    return bigDecimal.minus(this, other)
  }

  times(other: BigDecimal): BigDecimal {
    assert(
      this !== null,
      "Failed to multiply BigDecimals because left hand side is 'null'",
    )
    return bigDecimal.times(this, other)
  }

  div(other: BigDecimal): BigDecimal {
    assert(this !== null, "Failed to divide BigDecimals because left hand side is 'null'")
    return bigDecimal.dividedBy(this, other)
  }

  equals(other: BigDecimal): boolean {
    return BigDecimal.compare(this, other) == 0
  }

  notEqual(other: BigDecimal): boolean {
    return !(this == other)
  }

  lt(other: BigDecimal): boolean {
    return BigDecimal.compare(this, other) == -1
  }

  gt(other: BigDecimal): boolean {
    return BigDecimal.compare(this, other) == 1
  }

  le(other: BigDecimal): boolean {
    return !(this > other)
  }

  ge(other: BigDecimal): boolean {
    return !(this < other)
  }

  neg(): BigDecimal {
    assert(this !== null, "Failed to negate BigDecimal because the value of it is 'null'")
    return new BigDecimal(new BigInt(0)).minus(this)
  }

  /**
   * Returns −1 if a < b, 1 if a > b, and 0 if A == B
   */
  static compare(a: BigDecimal, b: BigDecimal): i32 {
    const diff = a.minus(b)
    if (diff.digits.isZero()) {
      return 0
    }
    return diff.digits > BigInt.fromI32(0) ? 1 : -1
  }
}
