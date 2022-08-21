import './eager_offset'
import { BigInt } from './numbers'
import { JSONValue } from './value'
import { Bytes, Result } from './collections'

/** Host JSON interface */
export declare namespace json {
  function fromBytes(data: Bytes): JSONValue
  function try_fromBytes(data: Bytes): Result<JSONValue, boolean>
  function toI64(decimal: string): i64
  function toU64(decimal: string): u64
  function toF64(decimal: string): f64
  function toBigInt(decimal: string): BigInt
}

export namespace json {
  export function fromString(data: string): JSONValue {
    let bytes = Bytes.fromUTF8(data)

    return json.fromBytes(bytes)
  }

  export function try_fromString(data: string): Result<JSONValue, boolean> {
    let bytes = Bytes.fromUTF8(data)

    return json.try_fromBytes(bytes)
  }
}
