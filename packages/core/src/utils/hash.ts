import { createHash } from "node:crypto";

// Adapted from https://stackoverflow.com/questions/77336994/stronger-type-for-value-in-json-stringifyvalue-any
type JSONSerializable =
  | string
  | number
  | boolean
  | null
  | JSONObject
  | JSONArray;
type JSONObject = { [key: string]: JSONSerializable };
type JSONArray = Array<JSONSerializable>;

/**
 * Generates a 10-character hexadecimal hash of a JSON-serializable value.
 */
export function hash(value: JSONSerializable): string {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 10);
}
