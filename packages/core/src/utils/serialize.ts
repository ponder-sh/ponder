import superjson from "superjson";

/**
 * Serialize function that handles BigInt.
 *
 * Forked from https://github.com/wevm/wagmi
 *
 * @param value to stringify
 * @returns the stringified output
 */
export function serialize(value: any) {
  return superjson.stringify(value);
}

/**
 * Deserialize function that handles BigInt.
 *
 * Forked from https://github.com/wevm/wagmi
 *
 * @param value to parse
 * @returns the output object
 */
export function deserialize(value: string): any {
  return superjson.parse(value);
}
