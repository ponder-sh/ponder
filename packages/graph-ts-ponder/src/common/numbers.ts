import type { i32, i64, u8, u32, u64 } from '../inject'
import { assert, changetype } from '../inject'
import { ByteArray, Bytes } from './collections'
import { typeConversion } from './conversion'

/** Host interface for BigInt arithmetic */
// export declare namespace bigInt {
//   function plus(x: bigint, y: bigint): bigint
//   function minus(x: bigint, y: bigint): bigint
//   function times(x: bigint, y: bigint): bigint
//   function dividedBy(x: bigint, y: bigint): bigint
//   function dividedByDecimal(x: bigint, y: BigDecimal): BigDecimal
//   function mod(x: bigint, y: bigint): bigint
//   function pow(x: bigint, exp: u8): bigint
//   function fromString(s: string): bigint
//   function bitOr(x: bigint, y: bigint): bigint
//   function bitAnd(x: bigint, y: bigint): bigint
//   function leftShift(x: bigint, bits: u8): bigint
//   function rightShift(x: bigint, bits: u8): bigint
// }

/** Host interface implementation */
// These functions operate on the JavaScript native `bigint` type.
// The native `bigint` type can be constructed using global.BigInt(...)
// export const bigInt = {
//   plus: (x: bigint, y: bigint) => x + y,
//   minus: (x: bigint, y: bigint) => x - y,
//   times: (x: bigint, y: bigint) => x * y,
//   dividedBy: (x: bigint, y: bigint) => x / y,
//   dividedByDecimal: (x: bigint, y: BigDecimal) => new BigDecimal(x / y.digits),
//   mod: (x: bigint, y: bigint) => x % y,
//   pow: (x: bigint, exp: number) => x ** global.BigInt(exp),
//   fromString: (s: string) => global.BigInt(s),
//   bitOr: (x: bigint, y: bigint) => x | y,
//   bitAnd: (x: bigint, y: bigint) => x & y,
//   leftShift: (x: bigint, bits: number) => x << global.BigInt(bits),
//   rightShift: (x: bigint, bits: number) => x >> global.BigInt(bits),
// }

/** Host interface for BigDecimal */
// export declare namespace bigDecimal {
//   function plus(x: BigDecimal, y: BigDecimal): BigDecimal
//   function minus(x: BigDecimal, y: BigDecimal): BigDecimal
//   function times(x: BigDecimal, y: BigDecimal): BigDecimal
//   function dividedBy(x: BigDecimal, y: BigDecimal): BigDecimal
//   function equals(x: BigDecimal, y: BigDecimal): boolean
//   function toString(bigDecimal: BigDecimal): string
//   function fromString(s: string): BigDecimal
// }

/** Host interface implementation */
// export const bigDecimal = {
//   plus: (x: BigDecimal, y: BigDecimal) => new BigDecimal(x.digits + y.digits),
//   minus: (x: BigDecimal, y: BigDecimal) => new BigDecimal(x.digits - y.digits),
//   times: (x: BigDecimal, y: BigDecimal) => new BigDecimal(x.digits * y.digits),
//   dividedBy: (x: BigDecimal, y: BigDecimal) => new BigDecimal(x.digits / y.digits),
//   equals: (x: BigDecimal, y: BigDecimal) => x.digits == y.digits,
//   toString: (x: BigDecimal) => x.digits.toString(),
//   fromString: (s: string) => new BigDecimal(global.BigInt(s)),
// }

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
  // From https://coolaj86.com/articles/convert-js-bigints-to-typedarrays/
  static uint8ArrayToNativeBigInt(buf: Uint8Array) {
    const hex: string[] = []
    buf.forEach((i) => {
      let h = i.toString(16)
      if (h.length % 2) {
        h = '0' + h
      }
      hex.push(h)
    })
    return global.BigInt('0x' + hex.join(''))
  }

  // From https://coolaj86.com/articles/convert-js-bigints-to-typedarrays/
  static fromNativeBigInt(nativeBigint: bigint): BigInt {
    let hex = global.BigInt(nativeBigint).toString(16)
    if (hex.length % 2) {
      hex = '0' + hex
    }
    const len = hex.length / 2
    const u8 = new Uint8Array(len)
    let i = 0
    let j = 0
    while (i < len) {
      u8[i] = parseInt(hex.slice(j, j + 2), 16)
      i += 1
      j += 2
    }
    return new BigInt(u8)
  }

  // From https://coolaj86.com/articles/convert-js-bigints-to-typedarrays/
  toNativeBigInt(): bigint {
    const hex: string[] = []
    this.forEach(function (i) {
      let h = i.toString(16)
      if (h.length % 2) {
        h = '0' + h
      }
      hex.push(h)
    })
    return global.BigInt('0x' + hex.join(''))
  }

  static fromByteArray(byteArray: ByteArray): BigInt {
    return new BigInt(byteArray)
  }

  static fromI32(x: i32): BigInt {
    return BigInt.fromByteArray(ByteArray.fromI32(x))
  }

  static fromU32(x: u32): BigInt {
    return BigInt.fromByteArray(ByteArray.fromU32(x))
  }

  static fromI64(x: i64): BigInt {
    return BigInt.fromByteArray(ByteArray.fromI64(x))
  }

  static fromU64(x: u64): BigInt {
    return BigInt.fromByteArray(ByteArray.fromU64(x))
  }

  static zero(): BigInt {
    return BigInt.fromI32(0)
  }

  /**
   * `bytes` assumed to be little-endian. If your input is big-endian, call `.reverse()` first.
   */
  static fromSignedBytes(bytes: Bytes): BigInt {
    return BigInt.fromNativeBigInt(
      global.BigInt(
        '0x' + bytes.reduce((str, byte) => str + byte.toString(16).padStart(2, '0'), ''),
      ),
    )
  }

  /**
   * `bytes` assumed to be little-endian. If your input is big-endian, call `.reverse()` first.
   */
  static fromUnsignedBytes(bytes: ByteArray): BigInt {
    return BigInt.fromNativeBigInt(
      global.BigInt(
        '0x' + bytes.reduce((str, byte) => str + byte.toString(16).padStart(2, '0'), ''),
      ),
    )
  }

  toHex(): string {
    return this.toNativeBigInt().toString()
  }

  toHexString(): string {
    return this.toNativeBigInt().toString()
  }

  toString(): string {
    return this.toNativeBigInt().toString()
  }

  static fromString(s: string): BigInt {
    return this.fromNativeBigInt(global.BigInt(s))
  }

  toI32(): i32 {
    return new ByteArray(this).toI32()
  }

  toU32(): u32 {
    return new ByteArray(this).toU32()
  }

  toI64(): i64 {
    return new ByteArray(this).toI64()
  }

  toU64(): u64 {
    return new ByteArray(this).toU64()
  }

  toBigDecimal(): BigDecimal {
    return new BigDecimal(this)
  }

  isZero(): boolean {
    return this == BigInt.fromI32(0)
  }

  isI32(): boolean {
    const nativeBigInt = this.toNativeBigInt()
    return (
      nativeBigInt >= Number.MIN_SAFE_INTEGER && nativeBigInt <= Number.MAX_SAFE_INTEGER
    )
  }

  abs(): BigInt {
    const nativeBigInt = this.toNativeBigInt()
    return BigInt.fromNativeBigInt(nativeBigInt >= 0 ? nativeBigInt : nativeBigInt * -1n)
  }

  // From https://golb.hplar.ch/2018/09/javascript-bigint.html
  sqrt(): bigint {
    const nativeBigInt = this.toNativeBigInt()
    const k = 2n
    if (nativeBigInt < 0n) {
      throw 'negative number is not supported'
    }

    let o = 0n
    let x = nativeBigInt
    let limit = 100

    while (x ** k !== k && x !== o && --limit) {
      o = x
      x = ((k - 1n) * x + nativeBigInt / x ** (k - 1n)) / k
    }

    return x
  }

  // Operators

  // @operator('+')
  plus(other: BigInt): BigInt {
    assert(this !== null, "Failed to sum BigInts because left hand side is 'null'")
    return BigInt.fromNativeBigInt(this.toNativeBigInt() + other.toNativeBigInt())
  }

  // @operator('-')
  minus(other: BigInt): BigInt {
    assert(this !== null, "Failed to subtract BigInts because left hand side is 'null'")
    return BigInt.fromNativeBigInt(this.toNativeBigInt() - other.toNativeBigInt())
  }

  // @operator('*')
  times(other: BigInt): BigInt {
    assert(this !== null, "Failed to multiply BigInts because left hand side is 'null'")
    return BigInt.fromNativeBigInt(this.toNativeBigInt() * other.toNativeBigInt())
  }

  // @operator('/')
  div(other: BigInt): BigInt {
    assert(this !== null, "Failed to divide BigInts because left hand side is 'null'")
    return BigInt.fromNativeBigInt(this.toNativeBigInt() / other.toNativeBigInt())
  }

  divDecimal(other: BigDecimal): BigDecimal {
    return new BigDecimal(
      BigInt.fromNativeBigInt(
        (this.toNativeBigInt() / other.digits.toNativeBigInt()) **
          other.exp.toNativeBigInt(),
      ),
    )
  }

  // @operator('%')
  mod(other: BigInt): BigInt {
    assert(
      this !== null,
      "Failed to apply module to BigInt because left hand side is 'null'",
    )
    return BigInt.fromNativeBigInt(this.toNativeBigInt() % other.toNativeBigInt())
  }

  // @operator('==')
  equals(other: BigInt): boolean {
    return this.toNativeBigInt() == other.toNativeBigInt()
  }

  // @operator('!=')
  notEqual(other: BigInt): boolean {
    return this.toNativeBigInt() != other.toNativeBigInt()
  }

  // @operator('<')
  lt(other: BigInt): boolean {
    return this.toNativeBigInt() < other.toNativeBigInt()
  }

  // @operator('>')
  gt(other: BigInt): boolean {
    return this.toNativeBigInt() > other.toNativeBigInt()
  }

  // @operator('<=')
  le(other: BigInt): boolean {
    return this.toNativeBigInt() <= other.toNativeBigInt()
  }

  // @operator('>=')
  ge(other: BigInt): boolean {
    return this.toNativeBigInt() >= other.toNativeBigInt()
  }

  // @operator.prefix('-')
  neg(): BigInt {
    return BigInt.fromNativeBigInt(this.toNativeBigInt() * -1n)
  }

  // @operator('|')
  bitOr(other: BigInt): BigInt {
    return BigInt.fromNativeBigInt(this.toNativeBigInt() | other.toNativeBigInt())
  }

  // @operator('&')
  bitAnd(other: BigInt): BigInt {
    return BigInt.fromNativeBigInt(this.toNativeBigInt() & other.toNativeBigInt())
  }

  // @operator('<<')
  leftShift(bits: u8): BigInt {
    return BigInt.fromNativeBigInt(this.toNativeBigInt() << global.BigInt(bits))
  }

  // @operator('>>')
  rightShift(bits: u8): BigInt {
    return BigInt.fromNativeBigInt(this.toNativeBigInt() >> global.BigInt(bits))
  }

  /// Limited to a low exponent to discourage creating a huge BigInt.
  pow(exp: u8): BigInt {
    return BigInt.fromNativeBigInt(this.toNativeBigInt() ** global.BigInt(exp))
  }

  /**
   * Returns −1 if a < b, 1 if a > b, and 0 if A == B
   */
  static compare(a: BigInt, b: BigInt): i32 {
    if (a.toNativeBigInt() == b.toNativeBigInt()) return 0
    return a.toNativeBigInt() > b.toNativeBigInt() ? 1 : -1
  }
}

// TODO: Figure out if this class is working at all lol
export class BigDecimal {
  digits: BigInt
  exp: BigInt

  constructor(bigInt: BigInt) {
    this.digits = bigInt
    this.exp = BigInt.fromI32(0)
  }

  static fromString(s: string): BigDecimal {
    return new BigDecimal(BigInt.fromString(s))
  }

  static zero(): BigDecimal {
    return new BigDecimal(BigInt.zero())
  }

  toString(): string {
    return this.digits.toString()
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

  // @operator('+')
  plus(other: BigDecimal): BigDecimal {
    assert(this !== null, "Failed to sum BigDecimals because left hand side is 'null'")
    throw new Error('BigDecimal.plus not implemented')
  }

  // @operator('-')
  minus(other: BigDecimal): BigDecimal {
    assert(
      this !== null,
      "Failed to subtract BigDecimals because left hand side is 'null'",
    )
    throw new Error('BigDecimal.minus not implemented')
  }

  // @operator('*')
  times(other: BigDecimal): BigDecimal {
    assert(
      this !== null,
      "Failed to multiply BigDecimals because left hand side is 'null'",
    )
    throw new Error('BigDecimal.times not implemented')
  }

  // @operator('/')
  div(other: BigDecimal): BigDecimal {
    assert(this !== null, "Failed to divide BigDecimals because left hand side is 'null'")
    throw new Error('BigDecimal.div not implemented')
  }

  // @operator('==')
  equals(other: BigDecimal): boolean {
    return BigDecimal.compare(this, other) == 0
  }

  // @operator('!=')
  notEqual(other: BigDecimal): boolean {
    return !(this == other)
  }

  // @operator('<')
  lt(other: BigDecimal): boolean {
    return BigDecimal.compare(this, other) == -1
  }

  // @operator('>')
  gt(other: BigDecimal): boolean {
    return BigDecimal.compare(this, other) == 1
  }

  // @operator('<=')
  le(other: BigDecimal): boolean {
    return !(this > other)
  }

  // @operator('>=')
  ge(other: BigDecimal): boolean {
    return !(this < other)
  }

  // @operator.prefix('-')
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
