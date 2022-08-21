import { Address, BigInt, BigDecimal } from './numbers'
import { Bytes, TypedMap } from './collections'
import { json } from './json'

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
 */
export type ValuePayload = u64

/**
 * A dynamically typed value.
 */
export class Value {
  constructor(public kind: ValueKind, public data: ValuePayload) {}

  toAddress(): Address {
    assert(this.kind == ValueKind.BYTES, 'Value is not an address.')
    return changetype<Address>(this.data as u32)
  }

  toBoolean(): boolean {
    if (this.kind == ValueKind.NULL) {
      return false
    }
    assert(this.kind == ValueKind.BOOL, 'Value is not a boolean.')
    return this.data != 0
  }

  toBytes(): Bytes {
    assert(this.kind == ValueKind.BYTES, 'Value is not a byte array.')
    return changetype<Bytes>(this.data as u32)
  }

  toI32(): i32 {
    if (this.kind == ValueKind.NULL) {
      return 0
    }
    assert(this.kind == ValueKind.INT, 'Value is not an i32.')
    return this.data as i32
  }

  toString(): string {
    assert(this.kind == ValueKind.STRING, 'Value is not a string.')
    return changetype<string>(this.data as u32)
  }

  toBigInt(): BigInt {
    assert(this.kind == ValueKind.BIGINT, 'Value is not a BigInt.')
    return changetype<BigInt>(this.data as u32)
  }

  toBigDecimal(): BigDecimal {
    assert(this.kind == ValueKind.BIGDECIMAL, 'Value is not a BigDecimal.')
    return changetype<BigDecimal>(this.data as u32)
  }

  toArray(): Array<Value> {
    assert(this.kind == ValueKind.ARRAY, 'Value is not an array.')
    return changetype<Array<Value>>(this.data as u32)
  }

  toBooleanArray(): Array<boolean> {
    let values = this.toArray()
    let output = new Array<boolean>(values.length)
    for (let i: i32 = 0; i < values.length; i++) {
      output[i] = values[i].toBoolean()
    }
    return output
  }

  toBytesArray(): Array<Bytes> {
    let values = this.toArray()
    let output = new Array<Bytes>(values.length)
    for (let i: i32 = 0; i < values.length; i++) {
      output[i] = values[i].toBytes()
    }
    return output
  }

  toStringArray(): Array<string> {
    let values = this.toArray()
    let output = new Array<string>(values.length)
    for (let i: i32 = 0; i < values.length; i++) {
      output[i] = values[i].toString()
    }
    return output
  }

  toI32Array(): Array<i32> {
    let values = this.toArray()
    let output = new Array<i32>(values.length)
    for (let i: i32 = 0; i < values.length; i++) {
      output[i] = values[i].toI32()
    }
    return output
  }

  toBigIntArray(): Array<BigInt> {
    let values = this.toArray()
    let output = new Array<BigInt>(values.length)
    for (let i: i32 = 0; i < values.length; i++) {
      output[i] = values[i].toBigInt()
    }
    return output
  }

  toBigDecimalArray(): Array<BigDecimal> {
    let values = this.toArray()
    let output = new Array<BigDecimal>(values.length)
    for (let i: i32 = 0; i < values.length; i++) {
      output[i] = values[i].toBigDecimal()
    }
    return output
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
        let arr = this.toArray()
        return '[' + arr.map<string>((elt) => elt.displayData()).join(', ') + ']'
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
    let output = new Array<Value>(input.length)
    for (let i: i32 = 0; i < input.length; i++) {
      output[i] = Value.fromBoolean(input[i])
    }
    return Value.fromArray(output)
  }

  static fromBytesArray(input: Array<Bytes>): Value {
    let output = new Array<Value>(input.length)
    for (let i: i32 = 0; i < input.length; i++) {
      output[i] = Value.fromBytes(input[i])
    }
    return Value.fromArray(output)
  }

  static fromI32Array(input: Array<i32>): Value {
    let output = new Array<Value>(input.length)
    for (let i: i32 = 0; i < input.length; i++) {
      output[i] = Value.fromI32(input[i])
    }
    return Value.fromArray(output)
  }

  static fromBigIntArray(input: Array<BigInt>): Value {
    let output = new Array<Value>(input.length)
    for (let i: i32 = 0; i < input.length; i++) {
      output[i] = Value.fromBigInt(input[i])
    }
    return Value.fromArray(output)
  }

  static fromBigDecimalArray(input: Array<BigDecimal>): Value {
    let output = new Array<Value>(input.length)
    for (let i: i32 = 0; i < input.length; i++) {
      output[i] = Value.fromBigDecimal(input[i])
    }
    return Value.fromArray(output)
  }

  static fromStringArray(input: Array<string>): Value {
    let output = new Array<Value>(input.length)
    for (let i: i32 = 0; i < input.length; i++) {
      output[i] = Value.fromString(input[i])
    }
    return Value.fromArray(output)
  }

  static fromAddressArray(input: Array<Address>): Value {
    let output = new Array<Value>(input.length)
    for (let i: i32 = 0; i < input.length; i++) {
      output[i] = Value.fromAddress(input[i])
    }
    return Value.fromArray(output)
  }

  static fromArray(input: Array<Value>): Value {
    return new Value(ValueKind.ARRAY, changetype<u32>(input))
  }

  static fromBigInt(n: BigInt): Value {
    return new Value(ValueKind.BIGINT, changetype<u32>(n))
  }

  static fromBoolean(b: bool): Value {
    return new Value(ValueKind.BOOL, b ? 1 : 0)
  }

  static fromBytes(bytes: Bytes): Value {
    return new Value(ValueKind.BYTES, changetype<u32>(bytes))
  }

  static fromNull(): Value {
    return new Value(ValueKind.NULL, 0)
  }

  static fromI32(n: i32): Value {
    return new Value(ValueKind.INT, n as u64)
  }

  static fromString(s: string): Value {
    return new Value(ValueKind.STRING, changetype<u32>(s))
  }

  static fromAddress(s: Address): Value {
    return new Value(ValueKind.BYTES, changetype<u32>(s))
  }

  static fromBigDecimal(n: BigDecimal): Value {
    return new Value(ValueKind.BIGDECIMAL, changetype<u32>(n))
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
    let decimalString = changetype<string>(this.data as u32)
    return json.toI64(decimalString)
  }

  toU64(): u64 {
    assert(this.kind == JSONValueKind.NUMBER, 'JSON value is not a number.')
    let decimalString = changetype<string>(this.data as u32)
    return json.toU64(decimalString)
  }

  toF64(): f64 {
    assert(this.kind == JSONValueKind.NUMBER, 'JSON value is not a number.')
    let decimalString = changetype<string>(this.data as u32)
    return json.toF64(decimalString)
  }

  toBigInt(): BigInt {
    assert(this.kind == JSONValueKind.NUMBER, 'JSON value is not a number.')
    let decimalString = changetype<string>(this.data as u32)
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
