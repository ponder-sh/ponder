import { Bytes } from './collections'

// /** Host type conversion interface */
// export declare namespace typeConversion {
//   function bytesToString(bytes: Uint8Array): string
//   function bytesToHex(bytes: Uint8Array): string
//   function bigIntToString(bigInt: Uint8Array): string
//   function bigIntToHex(bigInt: Uint8Array): string
//   function stringToH160(s: string): Bytes
//   function bytesToBase58(n: Uint8Array): string
// }

const bytesToString = (bytes: Uint8Array): string => {
  console.log('in bytesToString with: ', { bytes })
  const gotString = new TextDecoder().decode(bytes)
  console.log({ gotString })
  return gotString
}

const bytesToHex = (bytes: Uint8Array) => {
  return '0x' + bytes.reduce((str, byte) => str + byte.toString(16).padStart(2, '0'), '')
}

const bigIntToString = (bigInt: Uint8Array): string => {
  console.log('in bigIntToString with: ', { bigInt })
  const gotString = new TextDecoder().decode(bigInt)
  console.log({ gotString })
  return gotString
}

const bigIntToHex = (bigInt: Uint8Array) => {
  return '0x' + bigInt.reduce((str, byte) => str + byte.toString(16).padStart(2, '0'), '')
}

const hexToBytes = (hexString: string) => {
  if (hexString.startsWith('0x')) hexString = hexString.slice(2)
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  return Uint8Array.from(hexString.match(/.{1,2}/g).map((byte) => parseInt(byte, 16)))
}

export const typeConversion = {
  bytesToString: bytesToString,
  bytesToHex: bytesToHex,
  bigIntToString: bigIntToString,
  bigIntToHex: bigIntToHex,
  stringToH160: (s: string) => {
    return Bytes.from([1])
  },
  bytesToBase58: (n: Uint8Array): string => {
    return '123'
  },
  // These were added for ponder conversion convenience.
  hexToBytes: hexToBytes,
}
