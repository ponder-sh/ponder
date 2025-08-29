import type { QB } from "@/database/queryBuilder.js";
import { getPrimaryKeyColumns } from "@/drizzle/index.js";
import { onchain } from "@/drizzle/onchain.js";
import {
  InvalidStoreAccessError,
  InvalidStoreMethodError,
  NonRetryableUserError,
  UndefinedTableError,
} from "@/internal/errors.js";
import type { Schema } from "@/internal/types.js";
import type { Db } from "@/types/db.js";
import type { Table } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import type { Row } from "./cache.js";

export type IndexingStore = Db<Schema> & {
  qb: QB;
  isProcessingEvents: boolean;
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
        throw new NonRetryableUserError(
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
  if ("chainId" in key && String(key.chainId) === String(chainId)) return;
  throw new InvalidStoreAccessError(
    "chainId" in key
      ? `db.${method}(${getTableConfig(table).name}) cannot access rows on different chains when ordering is 'isolated'.`
      : `db.${method}(${getTableConfig(table).name}) must specify 'chainId' when ordering is 'isolated'.`,
  );
};
