import type { bool, i32 } from '../inject'
import { assert } from '../inject'
import { Bytes } from './collections'
import { BigDecimal } from './numbers'
import { Value } from './value'

/**
 * TypedMap entry.
 */
export class TypedMapEntry<K, V> {
  key: K
  value: V

  constructor(key: K, value: V) {
    this.key = key
    this.value = value
  }
}

/** Typed map */
export class TypedMap<K, V> {
  entries: Array<TypedMapEntry<K, V>>

  constructor() {
    this.entries = new Array<TypedMapEntry<K, V>>(0)
    // this.entries = []
  }

  set(key: K, value: V): void {
    const entry = this.getEntry(key)
    if (entry !== null) {
      entry.value = value
    } else {
      const entry = new TypedMapEntry<K, V>(key, value)
      this.entries.push(entry)
    }
  }

  getEntry(key: K): TypedMapEntry<K, V> | null {
    for (let i: i32 = 0; i < this.entries.length; i++) {
      if (this.entries[i].key == key) {
        return this.entries[i]
      }
    }
    return null
  }

  mustGetEntry(key: K): TypedMapEntry<K, V> {
    const entry = this.getEntry(key)
    assert(entry != null, `Entry for key ${key} does not exist in TypedMap`)
    return entry!
  }

  get(key: K): V | null {
    for (let i: i32 = 0; i < this.entries.length; i++) {
      if (this.entries[i].key == key) {
        return this.entries[i].value
      }
    }
    return null
  }

  mustGet(key: K): V {
    const value = this.get(key)
    assert(value != null, `Value for key ${key} does not exist in TypedMap`)
    return value!
  }

  isSet(key: K): bool {
    for (let i: i32 = 0; i < this.entries.length; i++) {
      if (this.entries[i].key == key) {
        return true
      }
    }
    return false
  }
}

/**
 * Common representation for entity data, storing entity attributes
 * as `string` keys and the attribute values as dynamically-typed
 * `Value` objects.
 */
export class Entity extends TypedMap<string, Value> {
  unset(key: string): void {
    this.set(key, Value.fromNull())
  }

  /** Assigns properties from sources to this Entity in right-to-left order */
  merge(sources: Array<Entity>): Entity {
    const target = this
    for (let i = 0; i < sources.length; i++) {
      const entries = sources[i].entries
      for (let j = 0; j < entries.length; j++) {
        target.set(entries[j].key, entries[j].value)
      }
    }
    return target
  }

  setString(key: string, value: string): void {
    this.set(key, Value.fromString(value))
  }

  setI32(key: string, value: i32): void {
    this.set(key, Value.fromI32(value))
  }

  setBigInt(key: string, value: bigint): void {
    this.set(key, Value.fromBigInt(value))
  }

  setBytes(key: string, value: Bytes): void {
    this.set(key, Value.fromBytes(value))
  }

  setBoolean(key: string, value: bool): void {
    this.set(key, Value.fromBoolean(value))
  }

  setBigDecimal(key: string, value: BigDecimal): void {
    this.set(key, Value.fromBigDecimal(value))
  }

  getString(key: string): string {
    return this.get(key)!.toString()
  }

  getI32(key: string): i32 {
    return this.get(key)!.toI32()
  }

  getBigInt(key: string): bigint {
    return this.get(key)!.toBigInt()
  }

  getBytes(key: string): Bytes {
    return this.get(key)!.toBytes()
  }

  getBoolean(key: string): boolean {
    return this.get(key)!.toBoolean()
  }

  getBigDecimal(key: string): BigDecimal {
    return this.get(key)!.toBigDecimal()
  }
}
