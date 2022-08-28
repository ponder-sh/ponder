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
  return bytes.toString()
}

const bytesToHexString = (bytes: Uint8Array): string => {
  const hex = []
  for (let i = 0; i < bytes.length; i++) {
    const current = bytes[i] < 0 ? bytes[i] + 256 : bytes[i]
    hex.push((current >>> 4).toString(16))
    hex.push((current & 0xf).toString(16))
  }
  return hex.join('')
}

export const typeConversion = {
  bytesToString: bytesToString,
  bytesToHex: bytesToHexString,
  bigIntToString: bytesToString,
  bigIntToHex: bytesToHexString,
  stringToH160: (s: string) => {
    return Bytes.from([1])
  },
  bytesToBase58: (n: Uint8Array): string => {
    return '123'
  },
}
