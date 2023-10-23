import { encodeAsText } from "@/utils/encoding";

import type { ModelInstance } from "../store";

/**
 * Convert a user-land model instance into a database-ready object.
 */
export function formatModelInstance(
  data: Partial<ModelInstance>,
  encodeBigInts: boolean
) {
  const instance: { [key: string]: string | number | null | bigint } = {};

  Object.entries(data).forEach(([key, value]) => {
    instance[key] = formatModelFieldValue({ value, encodeBigInts });
  });

  return instance;
}

/**
 * Convert a user-land model field value into a database-ready value.
 */
export function formatModelFieldValue({
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
