import bs58 from 'bs58'

import { Bytes } from './collections'

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

// TODO: implement!
export const typeConversion = {
  bytesToString: bytesToString,
  bytesToHex: bytesToHexString,
  bigIntToString: bytesToString,
  bigIntToHex: bytesToHexString,
  stringToH160: (s: string): Bytes => {
    return Bytes.fromUint8Array(new TextEncoder().encode(s).subarray(0, 20))
  },
  bytesToBase58: (n: Uint8Array): string => {
    return bs58.encode(n)
  },
}
