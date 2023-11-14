import { encodeAsText } from "@/utils/encoding.js";

import type { Row } from "../store.js";

/**
 * Convert a user-land row into a database-ready object.
 */
export function formatRow(data: Partial<Row>, encodeBigInts: boolean) {
  const instance: { [key: string]: string | number | null | bigint } = {};

  Object.entries(data).forEach(([key, value]) => {
    instance[key] = formatColumnValue({ value, encodeBigInts });
  });

  return instance;
}

/**
 * Convert a user-land column value into a database-ready column value.
 */
export function formatColumnValue({
  value,
  encodeBigInts,
}: {
  value: unknown;
  encodeBigInts: boolean;
}) {
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  } else if (typeof value === "bigint") {
    return encodeBigInts ? encodeAsText(value) : value;
  } else if (typeof value === "undefined") {
    return null;
  } else if (Array.isArray(value)) {
    if (typeof value[0] === "bigint") {
      return JSON.stringify(value.map(String));
    } else {
      return JSON.stringify(value);
    }
  } else {
    return value as string | number | null;
  }
}
