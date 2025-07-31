import { getPrimaryKeyColumns } from "@/drizzle/index.js";
import { onchain } from "@/drizzle/onchain.js";
import {
  BigIntSerializationError,
  CheckConstraintError,
  InvalidStoreAccessError,
  InvalidStoreMethodError,
  NonRetryableError,
  NotNullConstraintError,
  UndefinedTableError,
  UniqueConstraintError,
  getBaseError,
} from "@/internal/errors.js";
import type { Schema } from "@/internal/types.js";
import type { Db } from "@/types/db.js";
import type { Table } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import type { Row } from "./cache.js";

export type IndexingStore = Db<Schema>;

export const parseSqlError = (e: any): Error => {
  let error = getBaseError(e);

  if (error?.message?.includes("violates not-null constraint")) {
    error = new NotNullConstraintError(error.message);
  } else if (error?.message?.includes("violates unique constraint")) {
    error = new UniqueConstraintError(error.message);
  } else if (error?.message?.includes("violates check constraint")) {
    error = new CheckConstraintError(error.message);
  } else if (
    error?.message?.includes("Do not know how to serialize a BigInt")
  ) {
    error = new BigIntSerializationError(error.message);
    error.meta.push(
      "Hint:\n  The JSON column type does not support BigInt values. Use the replaceBigInts() helper function before inserting into the database. Docs: https://ponder.sh/docs/api-reference/ponder-utils#replacebigints",
    );
  }

  return error;
};

export const validateUpdateSet = (
  table: Table,
  set: Object,
  prev: Row,
): Object => {
  const primaryKeys = getPrimaryKeyColumns(table);

  for (const { js } of primaryKeys) {
    if (js in set) {
      // Note: Noop on the primary keys if they are identical, otherwise throw an error.
      if ((set as Row)[js] !== prev[js]) {
        throw new NonRetryableError(
          `Primary key column '${js}' cannot be updated`,
        );
      }
    }
  }

  return set;
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

export const checkTableAccess = (
  table: Table,
  method: "find" | "insert" | "update" | "delete",
  key: object,
  chainId?: number,
) => {
  if (chainId === undefined) return;
  if ("chainId" in key && key.chainId === chainId) return;
  throw new InvalidStoreAccessError(
    "chainId" in key
      ? `db.${method}() on ${getTableConfig(table).name} is accessing a row with chainId different from event's chainId.`
      : `db.${method}() on ${getTableConfig(table).name} must specify 'chainId' field in 'isolated' ordering.`,
  );
};
