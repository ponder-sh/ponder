import { Bytes, Wrapped } from '../common/collections'
import { Address, BigInt } from '../common/numbers'
import { abort, assert } from '../helper-functions'

/** Host Ethereum interface */
export declare namespace ethereum {
  function call(call: SmartContractCall): Array<Value> | null
  function encode(token: Value): Bytes | null
  function decode(types: string, data: Bytes): Value | null
}

export namespace ethereum {
  /** Type hint for Ethereum values. */
  export enum ValueKind {
    ADDRESS = 0,
    FIXED_BYTES = 1,
    BYTES = 2,
    INT = 3,
    UINT = 4,
    BOOL = 5,
    STRING = 6,
    FIXED_ARRAY = 7,
    ARRAY = 8,
    TUPLE = 9,
  }

  /**
   * Pointer type for Ethereum value data.
   *
   * Big enough to fit any pointer or native `this.data`.
   */
  export type ValuePayload = bigint

  /**
   * A dynamically typed value used when accessing Ethereum data.
   */
  export class Value {
    constructor(public kind: ValueKind, public data: ValuePayload) {}

    lt(other: Value): boolean {
      abort("Less than operator isn't supported in Value")
      return false
    }

    gt(other: Value): boolean {
      abort("Greater than operator isn't supported in Value")
      return false
    }

    toAddress(): Address {
      assert(this.kind == ValueKind.ADDRESS, 'Ethereum value is not an address')
      return this.data as number
    }

    toBoolean(): boolean {
      assert(this.kind == ValueKind.BOOL, 'Ethereum value is not a boolean.')
      return this.data != 0
    }

    toBytes(): Bytes {
      assert(
        this.kind == ValueKind.FIXED_BYTES || this.kind == ValueKind.BYTES,
        'Ethereum value is not bytes.',
      )
      return this.data as number
    }

    toI32(): number {
      assert(
        this.kind == ValueKind.INT || this.kind == ValueKind.UINT,
        'Ethereum value is not an int or uint.',
      )
      return Number(this.data)
    }

    toBigInt(): bigint {
      assert(
        this.kind == ValueKind.INT || this.kind == ValueKind.UINT,
        'Ethereum value is not an int or uint.',
      )
      return this.data as number
    }

    toString(): string {
      assert(this.kind == ValueKind.STRING, 'Ethereum value is not a string.')
      return this.data as number
    }

    toArray(): Array<Value> {
      assert(
        this.kind == ValueKind.ARRAY || this.kind == ValueKind.FIXED_ARRAY,
        'Ethereum value is not an array.',
      )
      return this.data as number
    }

    toTuple(): Tuple {
      assert(this.kind == ValueKind.TUPLE, 'Ethereum value is not a tuple.')
      return this.data as number
    }

    toTupleArray<T extends Tuple>(): Array<T> {
      assert(
        this.kind == ValueKind.ARRAY || this.kind == ValueKind.FIXED_ARRAY,
        'Ethereum value is not an array.',
      )
      const valueArray = this.toArray()
      const out = new Array<T>(valueArray.length)
      for (let i = 0; i < valueArray.length; i++) {
        out[i] = valueArray[i].toTuple()
      }
      return out
    }

    toBooleanArray(): Array<boolean> {
      assert(
        this.kind == ValueKind.ARRAY || this.kind == ValueKind.FIXED_ARRAY,
        'Ethereum value is not an array or fixed array.',
      )
      const valueArray = this.toArray()
      const out = new Array<boolean>(valueArray.length)
      for (let i = 0; i < valueArray.length; i++) {
        out[i] = valueArray[i].toBoolean()
      }
      return out
    }

    toBytesArray(): Array<Bytes> {
      assert(
        this.kind == ValueKind.ARRAY || this.kind == ValueKind.FIXED_ARRAY,
        'Ethereum value is not an array or fixed array.',
      )
      const valueArray = this.toArray()
      const out = new Array<Bytes>(valueArray.length)
      for (let i = 0; i < valueArray.length; i++) {
        out[i] = valueArray[i].toBytes()
      }
      return out
    }

    toAddressArray(): Array<Address> {
      assert(
        this.kind == ValueKind.ARRAY || this.kind == ValueKind.FIXED_ARRAY,
        'Ethereum value is not an array or fixed array.',
      )
      const valueArray = this.toArray()
      const out = new Array<Address>(valueArray.length)
      for (let i = 0; i < valueArray.length; i++) {
        out[i] = valueArray[i].toAddress()
      }
      return out
    }

    toStringArray(): Array<string> {
      assert(
        this.kind == ValueKind.ARRAY || this.kind == ValueKind.FIXED_ARRAY,
        'Ethereum value is not an array or fixed array.',
      )
      const valueArray = this.toArray()
      const out = new Array<string>(valueArray.length)
      for (let i = 0; i < valueArray.length; i++) {
        out[i] = valueArray[i].toString()
      }
      return out
    }

    toI32Array(): Array<number> {
      assert(
        this.kind == ValueKind.ARRAY || this.kind == ValueKind.FIXED_ARRAY,
        'Ethereum value is not an array or fixed array.',
      )
      const valueArray = this.toArray()
      const out = new Array<number>(valueArray.length)
      for (let i = 0; i < valueArray.length; i++) {
        out[i] = valueArray[i].toI32()
      }
      return out
    }

    toBigIntArray(): Array<bigint> {
      assert(
        this.kind == ValueKind.ARRAY || this.kind == ValueKind.FIXED_ARRAY,
        'Ethereum value is not an array or fixed array.',
      )
      const valueArray = this.toArray()
      const out = new Array<bigint>(valueArray.length)
      for (let i = 0; i < valueArray.length; i++) {
        out[i] = valueArray[i].toBigInt()
      }
      return out
    }

    static fromAddress(address: Address): Value {
      assert(address.length == 20, 'Address must contain exactly 20 bytes')
      return new Value(ValueKind.ADDRESS, address)
    }

    static fromBoolean(b: boolean): Value {
      return new Value(ValueKind.BOOL, b ? 1 : 0)
    }

    static fromBytes(bytes: Bytes): Value {
      return new Value(ValueKind.BYTES, bytes)
    }

    static fromFixedBytes(bytes: Bytes): Value {
      return new Value(ValueKind.FIXED_BYTES, bytes)
    }

    static fromI32(i: number): Value {
      return new Value(ValueKind.INT, BigInt.fromI32(i))
    }

    static fromSignedBigInt(i: bigint): Value {
      return new Value(ValueKind.INT, i)
    }

    static fromUnsignedBigInt(i: bigint): Value {
      return new Value(ValueKind.UINT, i)
    }

    static fromString(s: string): Value {
      return new Value(ValueKind.STRING, s)
    }

    static fromArray(values: Array<Value>): Value {
      return new Value(ValueKind.ARRAY, values)
    }

    static fromFixedSizedArray(values: Array<Value>): Value {
      return new Value(ValueKind.FIXED_ARRAY, values)
    }

    static fromTuple(values: Tuple): Value {
      return new Value(ValueKind.TUPLE, values)
    }

    static fromTupleArray(values: Array<Tuple>): Value {
      const out = new Array<Value>(values.length)
      for (let i = 0; i < values.length; i++) {
        out[i] = Value.fromTuple(values[i])
      }
      return Value.fromArray(out)
    }

    static fromBooleanArray(values: Array<boolean>): Value {
      const out = new Array<Value>(values.length)
      for (let i = 0; i < values.length; i++) {
        out[i] = Value.fromBoolean(values[i])
      }
      return Value.fromArray(out)
    }

    static fromBytesArray(values: Array<Bytes>): Value {
      const out = new Array<Value>(values.length)
      for (let i = 0; i < values.length; i++) {
        out[i] = Value.fromBytes(values[i])
      }
      return Value.fromArray(out)
    }

    static fromFixedBytesArray(values: Array<Bytes>): Value {
      const out = new Array<Value>(values.length)
      for (let i = 0; i < values.length; i++) {
        out[i] = Value.fromFixedBytes(values[i])
      }
      return Value.fromArray(out)
    }

    static fromAddressArray(values: Array<Address>): Value {
      const out = new Array<Value>(values.length)
      for (let i = 0; i < values.length; i++) {
        out[i] = Value.fromAddress(values[i])
      }
      return Value.fromArray(out)
    }

    static fromStringArray(values: Array<string>): Value {
      const out = new Array<Value>(values.length)
      for (let i = 0; i < values.length; i++) {
        out[i] = Value.fromString(values[i])
      }
      return Value.fromArray(out)
    }

    static fromI32Array(values: Array<number>): Value {
      const out = new Array<Value>(values.length)
      for (let i = 0; i < values.length; i++) {
        out[i] = Value.fromI32(values[i])
      }
      return Value.fromArray(out)
    }

    static fromSignedBigIntArray(values: Array<bigint>): Value {
      const out = new Array<Value>(values.length)
      for (let i = 0; i < values.length; i++) {
        out[i] = Value.fromSignedBigInt(values[i])
      }
      return Value.fromArray(out)
    }

    static fromUnsignedBigIntArray(values: Array<bigint>): Value {
      const out = new Array<Value>(values.length)
      for (let i = 0; i < values.length; i++) {
        out[i] = Value.fromUnsignedBigInt(values[i])
      }
      return Value.fromArray(out)
    }
  }

  /**
   * Common representation for Ethereum tuples / Solidity structs.
   *
   * This base class stores the tuple/struct values in an array. The Graph CLI
   * code generation then creates subclasses that provide named getters to
   * access the members by name.
   */
  export class Tuple extends Array<Value> {}

  /**
   * An Ethereum block.
   */
  export class Block {
    constructor(
      public hash: Bytes,
      public parentHash: Bytes,
      public unclesHash: Bytes,
      public author: Address,
      public stateRoot: Bytes,
      public transactionsRoot: Bytes,
      public receiptsRoot: Bytes,
      public number: bigint,
      public gasUsed: bigint,
      public gasLimit: bigint,
      public timestamp: bigint,
      public difficulty: bigint,
      public totalDifficulty: bigint,
      public size: bigint | null,
      public baseFeePerGas: bigint | null,
    ) {}
  }

  /**
   * An Ethereum transaction.
   */
  export class Transaction {
    constructor(
      public hash: Bytes,
      public index: bigint,
      public from: Address,
      public to: Address | null,
      public value: bigint,
      public gasLimit: bigint,
      public gasPrice: bigint,
      public input: Bytes,
      public nonce: bigint,
    ) {}
  }

  /**
   * An Ethereum transaction receipt.
   */
  export class TransactionReceipt {
    constructor(
      public transactionHash: Bytes,
      public transactionIndex: bigint,
      public blockHash: Bytes,
      public blockNumber: bigint,
      public cumulativeGasUsed: bigint,
      public gasUsed: bigint,
      public contractAddress: Address,
      public logs: Array<Log>,
      public status: bigint,
      public root: Bytes,
      public logsBloom: Bytes,
    ) {}
  }

  /**
   * An Ethereum event log.
   */
  export class Log {
    constructor(
      public address: Address,
      public topics: Array<Bytes>,
      public data: Bytes,
      public blockHash: Bytes,
      public blockNumber: Bytes,
      public transactionHash: Bytes,
      public transactionIndex: bigint,
      public logIndex: bigint,
      public transactionLogIndex: bigint,
      public logType: string,
      public removed: Wrapped<bool> | null,
    ) {}
  }

  /**
   * Common representation for Ethereum smart contract calls.
   */
  export class Call {
    constructor(
      public to: Address,
      public from: Address,
      public block: Block,
      public transaction: Transaction,
      public inputValues: Array<EventParam>,
      public outputValues: Array<EventParam>,
    ) {}
  }

  /**
   * Common representation for Ethereum smart contract events.
   */
  export class Event {
    constructor(
      public address: Address,
      public logIndex: bigint,
      public transactionLogIndex: bigint,
      public logType: string | null,
      public block: Block,
      public transaction: Transaction,
      public parameters: Array<EventParam>,
      public receipt: TransactionReceipt | null,
    ) {}
  }

  /**
   * A dynamically-typed Ethereum event parameter.
   */
  export class EventParam {
    constructor(public name: string, public value: Value) {}
  }

  export class SmartContractCall {
    contractName: string
    contractAddress: Address
    functionName: string
    functionSignature: string
    functionParams: Array<Value>

    constructor(
      contractName: string,
      contractAddress: Address,
      functionName: string,
      functionSignature: string,
      functionParams: Array<Value>,
    ) {
      this.contractName = contractName
      this.contractAddress = contractAddress
      this.functionName = functionName
      this.functionSignature = functionSignature
      this.functionParams = functionParams
    }
  }

  /**
   * Low-level interaction with Ethereum smart contracts
   */
  export class SmartContract {
    _name: string
    _address: Address

    protected constructor(name: string, address: Address) {
      this._name = name
      this._address = address
    }

    call(name: string, signature: string, params: Array<Value>): Array<Value> {
      const call = new SmartContractCall(
        this._name,
        this._address,
        name,
        signature,
        params,
      )
      const result = ethereum.call(call)
      assert(
        result != null,
        'Call reverted, probably because an `assert` or `require` in the contract failed, ' +
          'consider using `try_' +
          name +
          '` to handle this in the mapping.',
      )
      return result
    }

    tryCall(
      name: string,
      signature: string,
      params: Array<Value>,
    ): CallResult<Array<Value>> {
      const call = new SmartContractCall(
        this._name,
        this._address,
        name,
        signature,
        params,
      )
      const result = ethereum.call(call)
      if (result == null) {
        return new CallResult()
      } else {
        return CallResult.fromValue(result)
      }
    }
  }

  export class CallResult<T> {
    // `null` indicates a reverted call.
    private _value: Wrapped<T> | null

    constructor() {
      this._value = null
    }

    static fromValue<T>(value: T): CallResult<T> {
      const result = new CallResult<T>()
      result._value = new Wrapped(value)
      return result
    }

    get reverted(): bool {
      return this._value == null
    }

    get value(): T {
      assert(
        !this.reverted,
        'accessed value of a reverted call, ' +
          'please check the `reverted` field before accessing the `value` field',
      )
      return this._value.inner
    }
  }
}
