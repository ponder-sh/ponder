import type { QB } from "@/database/queryBuilder.js";
import { getPrimaryKeyColumns } from "@/drizzle/index.js";
import { onchain } from "@/drizzle/onchain.js";
import {
  InvalidStoreMethodError,
  NonRetryableError,
  UndefinedTableError,
} from "@/internal/errors.js";
import type { Schema } from "@/internal/types.js";
import type { Db } from "@/types/db.js";
import type { Table } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";

export type IndexingStore = Db<Schema> & { qb: QB };

export const validateUpdateSet = (table: Table, set: Object): Object => {
  const primaryKeys = getPrimaryKeyColumns(table);

  for (const { js } of primaryKeys) {
    if (js in set) {
      throw new NonRetryableError(
        `Primary key column '${js}' cannot be updated`,
      );
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
