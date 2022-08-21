import { ByteArray } from './index'

/**
 * Takes 2 ByteArrays and concatenates them
 * @param a - 1st ByteArray
 * @param b - 2nd ByteArray
 * @returns A concatenated ByteArray
 */
export function concat(a: ByteArray, b: ByteArray): ByteArray {
  let out = new Uint8Array(a.length + b.length)
  for (let i = 0; i < a.length; i++) {
    out[i] = a[i]
  }
  for (let j = 0; j < b.length; j++) {
    out[a.length + j] = b[j]
  }
  return changetype<ByteArray>(out)
}

/**
 * Used for parseCSV() below
 */
enum CSVState {
  BETWEEN = 0,
  UNQUOTED_VALUE = 1,
  QUOTED_VALUE = 2,
}

/**
 * Parses a CSV string into an array of strings.
 * @param csv CSV string.
 * @returns Array of strings.
 */
export function parseCSV(csv: string): Array<string> {
  let values = new Array<string>()
  let valueStart = 0
  let state = CSVState.BETWEEN

  for (let i: i32 = 0; i < csv.length; i++) {
    if (state == CSVState.BETWEEN) {
      if (csv.charAt(i) != ',') {
        if (csv.charAt(i) == '"') {
          state = CSVState.QUOTED_VALUE
          valueStart = i + 1
        } else {
          state = CSVState.UNQUOTED_VALUE
          valueStart = i
        }
      }
    } else if (state == CSVState.UNQUOTED_VALUE) {
      if (csv.charAt(i) == ',') {
        values.push(csv.substr(valueStart, i - valueStart))
        state = CSVState.BETWEEN
      }
    } else if (state == CSVState.QUOTED_VALUE) {
      if (csv.charAt(i) == '"') {
        values.push(csv.substr(valueStart, i - valueStart))
        state = CSVState.BETWEEN
      }
    }
  }

  return values
}

/**
 * Adds 0x1220 to the front of a ByteArray. This can be used when an IPFS hash is stored in an Etherum Bytes32 type.
 * The IPFS hash will fit in a Bytes32 when 0x1220 is removed. Since 0x1220 is currently in front of every single IPFS
 * hash, this works. But it is possible in the future that IPFS will update their spec.
 * @param a - The ByteArray without 0x1220 prefixed
 * @returns - The ByteArray with 0x1220 prefixed
 */
export function addQm(a: ByteArray): ByteArray {
  let out = new Uint8Array(34)
  out[0] = 0x12
  out[1] = 0x20
  for (let i = 0; i < 32; i++) {
    out[i + 2] = a[i]
  }
  return changetype<ByteArray>(out)
}
