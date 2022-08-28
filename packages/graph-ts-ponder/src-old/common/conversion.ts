import bs58 from 'bs58'

import { Bytes } from './collections'

const bytesToString = (bytes: Uint8Array): string => {
  console.log('in bytesToString', { bytes })
  console.log('in bytesToString', { string: bytes.toString() })

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
    // console.log('in stringToH160', {
    //   s,
    //   val: new TextEncoder().encode(s).subarray(0, 20),
    //   sval: new TextEncoder().encode(s).subarray(0, 20)
    // })
    return new TextEncoder().encode(s).subarray(0, 20)
  },
  bytesToBase58: (n: Uint8Array): string => {
    return bs58.encode(n)
  },
}
