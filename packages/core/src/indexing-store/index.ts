import { onchain } from "@/drizzle/onchain.js";
import {
  BigIntSerializationError,
  CheckConstraintError,
  InvalidStoreMethodError,
  NotNullConstraintError,
  UndefinedTableError,
  UniqueConstraintError,
  getBaseError,
} from "@/internal/errors.js";
import type { Event, Schema } from "@/internal/types.js";
import type { Db } from "@/types/db.js";
import type { Table } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";

export type IndexingStore = Db<Schema> & {
  event: Event | undefined;
};

export const parseSqlError = (e: any): Error => {
  let error = getBaseError(e);

  if (error?.message?.includes("violates not-null constraint")) {
    error = new NotNullConstraintError(error.message);
  } else if (error?.message?.includes("violates unique constraint")) {
    error = new UniqueConstraintError(error.message);
  } else if (error?.message.includes("violates check constraint")) {
    error = new CheckConstraintError(error.message);
  } else if (
    error?.message?.includes("Do not know how to serialize a BigInt")
  ) {
    error = new BigIntSerializationError(error.message);
    error.meta.push(
      "Hint:\n  The JSON column type does not support BigInt values. Use the replaceBigInts() helper function before inserting into the database. Docs: https://ponder.sh/docs/utilities/replace-bigints",
    );
  }

  return error;
};

/** Throw an error if `table` is not an `onchainTable`. */
export const checkOnchainTable = (
  table: Table,
  method: "find" | "insert" | "update" | "delete",
) => {
  if (table === undefined)
    throw new UndefinedTableError(
      `Table object passed to db.${method}() is undefined`,
    );

  if (onchain in table) return;

  throw new InvalidStoreMethodError(
    method === "find"
      ? `db.find() can only be used with onchain tables, and '${getTableConfig(table).name}' is an offchain table.`
      : `Indexing functions can only write to onchain tables, and '${getTableConfig(table).name}' is an offchain table.`,
  );
};
