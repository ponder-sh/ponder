import { BigInt } from 'temp_lib/index'
import { ByteArray, Bytes } from 'temp_lib/index'

// Test some BigInt methods.
export function testBigInt(): void {
  let minusFiveBytes = new ByteArray(2)
  minusFiveBytes[0] = 251
  minusFiveBytes[1] = 255
  let minusFive = BigInt.fromSignedBytes(Bytes.fromByteArray(minusFiveBytes))
  assert(minusFive == BigInt.fromI32(-5))
  assert(!minusFive.isZero() && minusFive.isI32())
  assert(minusFiveBytes.toU32() == 65531)
  assert(minusFiveBytes.toI32() == -5)

  let fiveBytes = new ByteArray(2)
  fiveBytes[0] = 5
  fiveBytes[1] = 0
  let five = BigInt.fromSignedBytes(Bytes.fromByteArray(fiveBytes))
  assert(!five.isZero() && five.isI32())
  assert(five == BigInt.fromI32(5))
  assert(five != minusFive)
  assert(five == BigInt.fromUnsignedBytes(Bytes.fromUint8Array(fiveBytes.subarray(0, 1))))
  assert(fiveBytes.toU32() == 5)
  assert(fiveBytes.toI32() == 5)

  let x = new ByteArray(1)
  x[0] = 255
  assert(BigInt.fromUnsignedBytes(Bytes.fromByteArray(x)) == BigInt.fromI32(255))

  let zero = BigInt.fromSignedBytes(Bytes.fromByteArray(new ByteArray(0)))
  assert(zero.isZero() && zero.isI32())
  assert(zero != five)
  assert(zero != minusFive)
  assert(minusFive < zero && minusFive <= zero)
  assert(five > zero && five >= zero)

  let aI32 = 77123455
  let a = BigInt.fromI32(aI32)
  assert(a == a && a.isI32() && a.toI32() == aI32)

  let bI32 = 48294181
  let b = BigInt.fromI32(bI32)
  assert(b == b && b.isI32() && b.toI32() == bI32)
  assert(b < a && b <= a)

  aI32 = 9292928
  a = BigInt.fromI32(9292928)
  assert(a == a && a.isI32() && a.toI32() == aI32)
  assert(a < b && a <= b)

  bI32 = -9717735
  b = BigInt.fromI32(bI32)
  assert(b == b && b.isI32() && b.toI32() == bI32)
  assert(b < a && b <= a)

  aI32 = 53499369
  a = BigInt.fromI32(aI32)
  assert(a == a && a.isI32() && a.toI32() == aI32)
  assert(b < a && b <= a)

  bI32 = 10242178
  b = BigInt.fromI32(bI32)
  assert(b == b && b.isI32() && b.toI32() == bI32)
  assert(b < a && b <= a)

  a = BigInt.fromI32(1000)
  b = BigInt.fromI32(900)
  assert(b < a && b <= a)

  a = BigInt.fromI32(123)
  b = BigInt.fromI32(124)
  assert(a < b && a <= b)
  assert(b > a && b >= a)

  a = BigInt.fromI32(I32.MIN_VALUE)
  b = BigInt.fromI32(I32.MAX_VALUE)
  assert(a < b && a <= b)
  assert(b > a && b >= a)
  assert(a.toI32() == -2147483648)
  assert(b.toI32() == 2147483647)

  a = BigInt.fromU32(U32.MIN_VALUE)
  b = BigInt.fromU32(U32.MAX_VALUE)
  let c = BigInt.fromU32(0)
  assert(a < b && a <= b, `a: ${a.toU32()}, b: ${b.toU32()}`)
  assert(b > a && b >= a, `a: ${a.toU32()}, b: ${b.toU32()}`)
  assert(a.toU32() == 0, `Actual value ${a.toU32()}`)
  assert(b.toU32() == 4294967295, `Actual value ${b.toU32()}`)
  assert(c.toU32() == 0, `Actual value ${c.toU32()}`)

  a = BigInt.fromI64(I64.MIN_VALUE)
  b = BigInt.fromI64(I64.MAX_VALUE)
  c = BigInt.fromI64(0)
  assert(a < b && a <= b, `a: ${a.toU64()}, b: ${b.toU64()}`)
  assert(b > a && b >= a, `a: ${a.toU64()}, b: ${b.toU64()}`)
  assert(a.toI64() == -9223372036854775808, `Actual value ${a.toI64()}`)
  assert(b.toI64() == 9223372036854775807, `Actual value ${b.toI64()}`)
  assert(c.toI64() == 0, `Actual value ${c.toI64()}`)

  a = BigInt.fromU64(U64.MIN_VALUE)
  b = BigInt.fromU64(U64.MAX_VALUE)
  c = BigInt.fromU64(0)
  assert(a < b && a <= b, `a: ${a.toU64()}, b: ${b.toU64()}`)
  assert(b > a && b >= a, `a: ${a.toU64()}, b: ${b.toU64()}`)
  assert(a.toU64() == 0, `Actual value ${a.toU64()}`)
  assert(b.toU64() == 18446744073709551615, `Actual value ${b.toU64()}`)
  assert(c.toU64() == 0, `Actual value ${c.toU64()}`)

  // This is 8071860 in binary.
  let blockNumber = new ByteArray(3)
  blockNumber[0] = 180
  blockNumber[1] = 42
  blockNumber[2] = 123
  let blockNumberBigInt = BigInt.fromByteArray(blockNumber)
  let latestBlock = BigInt.fromI32(8200001)
  assert(!blockNumberBigInt.gt(latestBlock))

  let longArray = new ByteArray(5)
  longArray[0] = 251
  longArray[1] = 255
  longArray[2] = 251
  longArray[3] = 255
  longArray[4] = 0
  assert(longArray.toU32() == 4294705147)
  assert(longArray.toI32() == 4294705147)

  let bytes = Bytes.fromHexString('0x56696b746f726961')
  assert((bytes[0] = 0x56))
  assert((bytes[1] = 0x69))
  assert((bytes[2] = 0x6b))
  assert((bytes[3] = 0x74))
  assert((bytes[4] = 0x6f))
  assert((bytes[5] = 0x72))
  assert((bytes[6] = 0x69))
  assert((bytes[7] = 0x61))

  assert(ByteArray.fromI32(1) == ByteArray.fromI32(1))
  assert(ByteArray.fromI32(1) != ByteArray.fromI32(2))

  assert(
    Bytes.fromUTF8('Hello, World!') ==
      ByteArray.fromHexString('0x48656c6c6f2c20576f726c6421'),
  )
}
