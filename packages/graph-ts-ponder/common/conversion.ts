import './eager_offset'
import { Bytes } from './collections'

/** Host type conversion interface */
export declare namespace typeConversion {
  function bytesToString(bytes: Uint8Array): string
  function bytesToHex(bytes: Uint8Array): string
  function bigIntToString(bigInt: Uint8Array): string
  function bigIntToHex(bigInt: Uint8Array): string
  function stringToH160(s: string): Bytes
  function bytesToBase58(n: Uint8Array): string
}
