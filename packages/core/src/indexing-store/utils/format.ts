import type { Schema } from "@/schema/types.js";
import { isEnumColumn, isManyColumn, isOneColumn } from "@/schema/utils.js";
import { encodeAsText } from "@/utils/encoding.js";
import { hexToBytes, isHex } from "viem";
import type { Row } from "../store.js";

/**
 * Convert a user-land row into a database-ready object.
 */
export function formatRow(
  data: Partial<Row>,
  table: Schema["tables"][keyof Schema["tables"]],
  encoding: "sqlite" | "postgres",
) {
  const instance: { [key: string]: string | number | null | bigint | Buffer } =
    {};

  for (const [key, value] of Object.entries(data)) {
    instance[key] = formatColumnValue(value, table[key], encoding);
  }

  return instance;
}

/**
 * Convert a user-land column value into a database-ready column value.
 */
export function formatColumnValue(
  value: unknown,
  column: Schema["tables"][keyof Schema["tables"]][string],
  encoding: "sqlite" | "postgres",
): string | number | null | bigint | Buffer {
  if (isEnumColumn(column)) {
    if (typeof value !== "string") throw Error();
    return value;
  } else if (isOneColumn(column)) {
    throw Error("one");
  } else if (isManyColumn(column)) {
    throw Error("many");
  } else {
    if (column.optional && (value === undefined || value === null)) {
      return null;
    }

    if (column.list) {
      // Note: much more validation could be done on list.
      if (!Array.isArray(value)) throw Error("List");

      if (column.type === "bigint") {
        return JSON.stringify(value.map(String));
      } else {
        return JSON.stringify(value);
      }
    }

    if (column.type === "bigint") {
      if (typeof value !== "bigint") throw Error("bigint");
      return encoding === "sqlite" ? encodeAsText(value) : value;
    } else if (column.type === "boolean") {
      if (typeof value !== "boolean") throw Error("boolean");
      return value ? 1 : 0;
    } else if (column.type === "float") {
      if (typeof value !== "number") throw Error("float");
      return value;
    } else if (column.type === "hex") {
      if (typeof value !== "string" || !isHex(value)) throw Error("hex");
      return Buffer.from(hexToBytes(value));
    } else if (column.type === "int") {
      if (typeof value !== "number") throw Error("int");
      return value;
    } else if (column.type === "string") {
      if (typeof value === "object") console.log(value, column.optional);
      if (typeof value !== "string") throw Error("string");
      return value;
    }

    // Note: it should be impossible to get to this line
    throw Error("Unable to encode column data");
  }
}
