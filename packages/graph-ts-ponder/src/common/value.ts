import type { bool, f64, i32, i64, u32, u64 } from '../inject'
import { assert, changetype } from '../inject'
import { Bytes, TypedMap } from './collections'
import { json } from './json'
import { Address, BigDecimal } from './numbers'

/**
 * Enum for supported value types.
 */
export enum ValueKind {
  STRING = 0,
  INT = 1,
  BIGDECIMAL = 2,
  BOOL = 3,
  ARRAY = 4,
  NULL = 5,
  BYTES = 6,
  BIGINT = 7,
}

const VALUE_KIND_NAMES = [
  'String',
  'Int',
  'BigDecimal',
  'bool',
  'Array',
  'null',
  'Bytes',
  'BigInt',
]

/**
 * Pointer type for Value data.
 *
 * Big enough to fit any pointer or native `this.data`.
 *
 * PONDER: Here are the types by ValueKind:
 *
 * STRING: string
 * INT: number
 * BIGDECIMAL: BigDecimal
 * BOOL: boolean
 * ARRAY: Value[]
 * NULL: null
 * BYTES: Bytes
 * BIGINT: bigint
 */

export type ValuePayload =
  | string
  | number
  | BigDecimal
  | boolean
  | Value[]
  | null
  | Bytes
  | bigint

/**
 * A dynamically typed value.
 */
export class Value {
  constructor(public kind: ValueKind, public data: ValuePayload) {}

  toAddress(): Address {
    assert(this.kind == ValueKind.BYTES, 'Value is not an address.')
    return Address.fromBytes(this.data as Bytes)
  }

  toBoolean(): boolean {
    if (this.kind == ValueKind.NULL) {
      return false
    }
    assert(this.kind == ValueKind.BOOL, 'Value is not a boolean.')
    return this.data as boolean
  }

  toBytes(): Bytes {
    assert(this.kind == ValueKind.BYTES, 'Value is not a byte array.')
    return this.data as Bytes
  }

  toI32(): i32 {
    if (this.kind == ValueKind.NULL) {
      return 0
    }
    assert(this.kind == ValueKind.INT, 'Value is not an i32.')
    // NOTE: Test this.
    return this.data as number
  }

  toString(): string {
    assert(this.kind == ValueKind.STRING, 'Value is not a string.')
    return this.data as string
  }

  toBigInt(): bigint {
    assert(this.kind == ValueKind.BIGINT, 'Value is not a BigInt.')
    // NOTE: Test this.
    return this.data as bigint
  }

  toBigDecimal(): BigDecimal {
    assert(this.kind == ValueKind.BIGDECIMAL, 'Value is not a BigDecimal.')
    // NOTE: Test this.
    return new BigDecimal(this.data as bigint)
  }

  toArray(): Array<Value> {
    assert(this.kind == ValueKind.ARRAY, 'Value is not an array.')
    return this.data as Value[]
  }

  toBooleanArray(): Array<boolean> {
    return this.toArray().map((val) => val.toBoolean())
  }

  toBytesArray(): Array<Bytes> {
    return this.toArray().map((val) => val.toBytes())
  }

  toStringArray(): Array<string> {
    return this.toArray().map((val) => val.toString())
  }

  toI32Array(): Array<i32> {
    return this.toArray().map((val) => val.toI32())
  }

  toBigIntArray(): Array<bigint> {
    return this.toArray().map((val) => val.toBigInt())
  }

  toBigDecimalArray(): Array<BigDecimal> {
    return this.toArray().map((val) => val.toBigDecimal())
  }

  /** Return a string that indicates the kind of value `this` contains for
   * logging and error messages */
  displayKind(): string {
    if (this.kind >= VALUE_KIND_NAMES.length) {
      return `Unknown (${this.kind})`
    } else {
      return VALUE_KIND_NAMES[this.kind]
    }
  }

  /** Return a string representation of the value of `this` for logging and
   * error messages */
  displayData(): string {
    switch (this.kind) {
      case ValueKind.STRING:
        return this.toString()
      case ValueKind.INT:
        return this.toI32().toString()
      case ValueKind.BIGDECIMAL:
        return this.toBigDecimal().toString()
      case ValueKind.BOOL:
        return this.toBoolean().toString()
      case ValueKind.ARRAY:
        return (
          '[' +
          this.toArray()
            .map<string>((elt) => elt.displayData())
            .join(', ') +
          ']'
        )
      case ValueKind.NULL:
        return 'null'
      case ValueKind.BYTES:
        return this.toBytes().toHexString()
      case ValueKind.BIGINT:
        return this.toBigInt().toString()
      default:
        return `Unknown data (kind = ${this.kind})`
    }
  }

  static fromBooleanArray(input: Array<boolean>): Value {
    return Value.fromArray(input.map((val) => Value.fromBoolean(val)))
  }

  static fromBytesArray(input: Array<Bytes>): Value {
    return Value.fromArray(input.map((val) => Value.fromBytes(val)))
  }

  static fromI32Array(input: Array<i32>): Value {
    return Value.fromArray(input.map((val) => Value.fromI32(val)))
  }

  static fromBigIntArray(input: Array<bigint>): Value {
    return Value.fromArray(input.map((val) => Value.fromBigInt(val)))
  }

  static fromBigDecimalArray(input: Array<BigDecimal>): Value {
    return Value.fromArray(input.map((val) => Value.fromBigDecimal(val)))
  }

  static fromStringArray(input: Array<string>): Value {
    return Value.fromArray(input.map((val) => Value.fromString(val)))
  }

  static fromAddressArray(input: Array<Address>): Value {
    return Value.fromArray(input.map((val) => Value.fromAddress(val)))
  }

  static fromArray(input: Array<Value>): Value {
    return new Value(ValueKind.ARRAY, input)
  }

  static fromBigInt(n: bigint): Value {
    return new Value(ValueKind.BIGINT, n)
  }

  static fromBoolean(b: bool): Value {
    return new Value(ValueKind.BOOL, b)
  }

  static fromBytes(bytes: Bytes): Value {
    return new Value(ValueKind.BYTES, bytes)
  }

  static fromNull(): Value {
    return new Value(ValueKind.NULL, null)
  }

  static fromI32(n: i32): Value {
    return new Value(ValueKind.INT, n)
  }

  static fromString(s: string): Value {
    return new Value(ValueKind.STRING, s)
  }

  static fromAddress(s: Address): Value {
    return new Value(ValueKind.BYTES, s)
  }

  static fromBigDecimal(n: BigDecimal): Value {
    return new Value(ValueKind.BIGDECIMAL, n)
  }
}

/** Type hint for JSON values. */
export enum JSONValueKind {
  NULL = 0,
  BOOL = 1,
  NUMBER = 2,
  STRING = 3,
  ARRAY = 4,
  OBJECT = 5,
}

/**
 * Pointer type for JSONValue data.
 *
 * Big enough to fit any pointer or native `this.data`.
 */
export type JSONValuePayload = u64

export class JSONValue {
  kind: JSONValueKind
  data: JSONValuePayload

  isNull(): boolean {
    return this.kind == JSONValueKind.NULL
  }

  toBool(): boolean {
    assert(this.kind == JSONValueKind.BOOL, 'JSON value is not a boolean.')
    return this.data != 0
  }

  toI64(): i64 {
    assert(this.kind == JSONValueKind.NUMBER, 'JSON value is not a number.')
    const decimalString = changetype<string>(this.data as u32)
    return json.toI64(decimalString)
  }

  toU64(): u64 {
    assert(this.kind == JSONValueKind.NUMBER, 'JSON value is not a number.')
    const decimalString = changetype<string>(this.data as u32)
    return json.toU64(decimalString)
  }

  toF64(): f64 {
    assert(this.kind == JSONValueKind.NUMBER, 'JSON value is not a number.')
    const decimalString = changetype<string>(this.data as u32)
    return json.toF64(decimalString)
  }

  toBigInt(): bigint {
    assert(this.kind == JSONValueKind.NUMBER, 'JSON value is not a number.')
    const decimalString = changetype<string>(this.data as u32)
    return json.toBigInt(decimalString)
  }

  toString(): string {
    assert(this.kind == JSONValueKind.STRING, 'JSON value is not a string.')
    return changetype<string>(this.data as u32)
  }

  toArray(): Array<JSONValue> {
    assert(this.kind == JSONValueKind.ARRAY, 'JSON value is not an array.')
    return changetype<Array<JSONValue>>(this.data as u32)
  }

  toObject(): TypedMap<string, JSONValue> {
    assert(this.kind == JSONValueKind.OBJECT, 'JSON value is not an object.')
    return changetype<TypedMap<string, JSONValue>>(this.data as u32)
  }
}
