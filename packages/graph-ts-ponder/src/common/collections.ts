import type { i32, i64, u8, u32, u64 } from '../inject'
import { assert, changetype } from '../inject'
import { typeConversion } from './conversion'

/**
 * Byte array
 */
export class ByteArray extends Uint8Array {
  /**
   * Returns bytes in little-endian order.
   */
  static fromI32(x: i32): ByteArray {
    const self = new ByteArray(4)
    self[0] = x as u8
    self[1] = (x >> 8) as u8
    self[2] = (x >> 16) as u8
    self[3] = (x >> 24) as u8
    return self
  }

  /**
   * Returns bytes in little-endian order.
   */
  static fromU32(x: u32): ByteArray {
    const self = new ByteArray(4)
    self[0] = x as u8
    self[1] = (x >> 8) as u8
    self[2] = (x >> 16) as u8
    self[3] = (x >> 24) as u8
    return self
  }

  /**
   * Returns bytes in little-endian order.
   */
  static fromI64(x: i64): ByteArray {
    const self = new ByteArray(8)
    self[0] = x as u8
    self[1] = (x >> 8) as u8
    self[2] = (x >> 16) as u8
    self[3] = (x >> 24) as u8
    self[4] = (x >> 32) as u8
    self[5] = (x >> 40) as u8
    self[6] = (x >> 48) as u8
    self[7] = (x >> 56) as u8
    return self
  }

  /**
   * Returns bytes in little-endian order.
   */
  static fromU64(x: u64): ByteArray {
    const self = new ByteArray(8)
    self[0] = x as u8
    self[1] = (x >> 8) as u8
    self[2] = (x >> 16) as u8
    self[3] = (x >> 24) as u8
    self[4] = (x >> 32) as u8
    self[5] = (x >> 40) as u8
    self[6] = (x >> 48) as u8
    self[7] = (x >> 56) as u8
    return self
  }

  static empty(): ByteArray {
    return ByteArray.fromI32(0)
  }

  /**
   * Convert the string `hex` which must consist of an even number of
   * hexadecimal digits to a `ByteArray`. The string `hex` can optionally
   * start with '0x'
   */
  static fromHexString(hex: string): ByteArray {
    assert(hex.length % 2 == 0, 'input ' + hex + ' has odd length')
    return new ByteArray(typeConversion.hexToBytes(hex))
  }

  static fromUTF8(str: string): ByteArray {
    const utf8 = String.UTF8.encode(str)
    return changetype<ByteArray>(ByteArray.wrap(utf8))
  }

  static fromBigInt(bigInt: bigint): ByteArray {
    return changetype<ByteArray>(bigInt)
  }

  toHex(): string {
    return typeConversion.bytesToHex(this)
  }

  toHexString(): string {
    return typeConversion.bytesToHex(this)
  }

  toString(): string {
    return typeConversion.bytesToString(this)
  }

  toBase58(): string {
    return typeConversion.bytesToBase58(this)
  }

  /**
   * Interprets the byte array as a little-endian U32.
   * Throws in case of overflow.
   */

  toU32(): u32 {
    for (let i = 4; i < this.length; i++) {
      if (this[i] != 0) {
        assert(false, 'overflow converting ' + this.toHexString() + ' to u32')
      }
    }
    const paddedBytes = new Bytes(4)
    paddedBytes[0] = 0
    paddedBytes[1] = 0
    paddedBytes[2] = 0
    paddedBytes[3] = 0
    const minLen = paddedBytes.length < this.length ? paddedBytes.length : this.length
    for (let i = 0; i < minLen; i++) {
      paddedBytes[i] = this[i]
    }
    let x: u32 = 0
    x = (x | paddedBytes[3]) << 8
    x = (x | paddedBytes[2]) << 8
    x = (x | paddedBytes[1]) << 8
    x = x | paddedBytes[0]
    return x
  }

  /**
   * Interprets the byte array as a little-endian I32.
   * Throws in case of overflow.
   */

  toI32(): i32 {
    const isNeg = this.length > 0 && this[this.length - 1] >> 7 == 1
    const padding = isNeg ? 255 : 0
    for (let i = 4; i < this.length; i++) {
      if (this[i] != padding) {
        assert(false, 'overflow converting ' + this.toHexString() + ' to i32')
      }
    }
    const paddedBytes = new Bytes(4)
    paddedBytes[0] = padding
    paddedBytes[1] = padding
    paddedBytes[2] = padding
    paddedBytes[3] = padding
    const minLen = paddedBytes.length < this.length ? paddedBytes.length : this.length
    for (let i = 0; i < minLen; i++) {
      paddedBytes[i] = this[i]
    }
    let x: i32 = 0
    x = (x | paddedBytes[3]) << 8
    x = (x | paddedBytes[2]) << 8
    x = (x | paddedBytes[1]) << 8
    x = x | paddedBytes[0]
    return x
  }

  /** Create a new `ByteArray` that consist of `this` directly followed by
   * the bytes from `other` */
  concat(other: ByteArray): ByteArray {
    const newArray = new ByteArray(this.length + other.length)
    newArray.set(this, 0)
    newArray.set(other, this.length)
    return newArray
  }

  /** Create a new `ByteArray` that consists of `this` directly followed by
   * the representation of `other` as bytes */
  concatI32(other: i32): ByteArray {
    return this.concat(ByteArray.fromI32(other))
  }

  /**
   * Interprets the byte array as a little-endian I64.
   * Throws in case of overflow.
   */

  toI64(): i64 {
    const isNeg = this.length > 0 && this[this.length - 1] >> 7 == 1
    const padding = isNeg ? 255 : 0
    for (let i = 8; i < this.length; i++) {
      if (this[i] != padding) {
        assert(false, 'overflow converting ' + this.toHexString() + ' to i64')
      }
    }
    const paddedBytes = new Bytes(8)
    paddedBytes[0] = padding
    paddedBytes[1] = padding
    paddedBytes[2] = padding
    paddedBytes[3] = padding
    paddedBytes[4] = padding
    paddedBytes[5] = padding
    paddedBytes[6] = padding
    paddedBytes[7] = padding
    const minLen = paddedBytes.length < this.length ? paddedBytes.length : this.length
    for (let i = 0; i < minLen; i++) {
      paddedBytes[i] = this[i]
    }
    let x: i64 = 0
    x = (x | paddedBytes[7]) << 8
    x = (x | paddedBytes[6]) << 8
    x = (x | paddedBytes[5]) << 8
    x = (x | paddedBytes[4]) << 8
    x = (x | paddedBytes[3]) << 8
    x = (x | paddedBytes[2]) << 8
    x = (x | paddedBytes[1]) << 8
    x = x | paddedBytes[0]
    return x
  }

  /**
   * Interprets the byte array as a little-endian U64.
   * Throws in case of overflow.
   */

  toU64(): u64 {
    for (let i = 8; i < this.length; i++) {
      if (this[i] != 0) {
        assert(false, 'overflow converting ' + this.toHexString() + ' to u64')
      }
    }
    const paddedBytes = new Bytes(8)
    paddedBytes[0] = 0
    paddedBytes[1] = 0
    paddedBytes[2] = 0
    paddedBytes[3] = 0
    paddedBytes[4] = 0
    paddedBytes[5] = 0
    paddedBytes[6] = 0
    paddedBytes[7] = 0
    const minLen = paddedBytes.length < this.length ? paddedBytes.length : this.length
    for (let i = 0; i < minLen; i++) {
      paddedBytes[i] = this[i]
    }
    let x: u64 = 0
    x = (x | paddedBytes[7]) << 8
    x = (x | paddedBytes[6]) << 8
    x = (x | paddedBytes[5]) << 8
    x = (x | paddedBytes[4]) << 8
    x = (x | paddedBytes[3]) << 8
    x = (x | paddedBytes[2]) << 8
    x = (x | paddedBytes[1]) << 8
    x = x | paddedBytes[0]
    return x
  }

  // @operator('==')
  equals(other: ByteArray): boolean {
    if (this.length != other.length) {
      return false
    }
    for (let i = 0; i < this.length; i++) {
      if (this[i] != other[i]) {
        return false
      }
    }
    return true
  }

  // @operator('!=')
  notEqual(other: ByteArray): boolean {
    return !(this == other)
  }
}

/** A dynamically-sized byte array. */
export class Bytes extends ByteArray {
  static fromByteArray(byteArray: ByteArray): Bytes {
    return changetype<Bytes>(byteArray)
  }

  static fromUint8Array(uint8Array: Uint8Array): Bytes {
    return changetype<Bytes>(uint8Array)
  }

  /**
   * Convert the string `hex` which must consist of an even number of
   * hexadecimal digits to a `ByteArray`. The string `hex` can optionally
   * start with '0x'
   */
  static fromHexString(str: string): Bytes {
    return changetype<Bytes>(ByteArray.fromHexString(str))
  }

  static fromUTF8(str: string): Bytes {
    return Bytes.fromByteArray(ByteArray.fromUTF8(str))
  }

  static fromI32(i: i32): Bytes {
    return changetype<Bytes>(ByteArray.fromI32(i))
  }

  static empty(): Bytes {
    return changetype<Bytes>(ByteArray.empty())
  }

  concat(other: Bytes): Bytes {
    return changetype<Bytes>(super.concat(other))
  }

  concatI32(other: i32): Bytes {
    return changetype<Bytes>(super.concat(ByteArray.fromI32(other)))
  }
}

/**
 * The result of an operation, with a corresponding value and error type.
 */
export class Result<V, E> {
  _value: Wrapped<V> | null
  _error: Wrapped<E> | null

  get isOk(): boolean {
    return this._value !== null
  }

  get isError(): boolean {
    return this._error !== null
  }

  get value(): V {
    assert(this._value != null, 'Trying to get a value from an error result')
    return changetype<Wrapped<V>>(this._value).inner
  }

  get error(): E {
    assert(this._error != null, 'Trying to get an error from a successful result')
    return changetype<Wrapped<E>>(this._error).inner
  }
}

// This is used to wrap a generic so that it can be unioned with `null`, working around limitations
// with primitives.
export class Wrapped<T> {
  inner: T

  constructor(inner: T) {
    this.inner = inner
  }
}
