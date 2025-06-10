import { BigIntSerializationError, getBaseError } from "@/internal/errors.js";
import { customType } from "drizzle-orm/pg-core";

export const json = customType<{
  data: unknown;
}>({
  dataType() {
    return "json";
  },
  toDriver(value) {
    try {
      return JSON.stringify(value);
    } catch (_error) {
      let error = getBaseError(_error);
      if (error?.message?.includes("Do not know how to serialize a BigInt")) {
        error = new BigIntSerializationError(error.message);
        error.meta.push(
          "Hint:\n  The JSON column type does not support BigInt values. Use the replaceBigInts() helper function before inserting into the database. Docs: https://ponder.sh/docs/api-reference/ponder-utils#replacebigints",
        );
      }

      throw error;
    }
  },
  fromDriver(value) {
    if (typeof value === "string") {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }
    return value;
  },
});

export const jsonb = customType<{
  data: unknown;
}>({
  dataType() {
    return "jsonb";
  },
  toDriver(value) {
    try {
      return JSON.stringify(value);
    } catch (_error) {
      let error = getBaseError(_error);
      if (error?.message?.includes("Do not know how to serialize a BigInt")) {
        error = new BigIntSerializationError(error.message);
        error.meta.push(
          "Hint:\n  The JSON column type does not support BigInt values. Use the replaceBigInts() helper function before inserting into the database. Docs: https://ponder.sh/docs/api-reference/ponder-utils#replacebigints",
        );
      }

      throw error;
    }
  },
  fromDriver(value) {
    if (typeof value === "string") {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }
    return value;
  },
});
