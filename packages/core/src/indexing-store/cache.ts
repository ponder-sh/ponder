import type { Database } from "@/database/index.js";
import { getPrimaryKeyColumns } from "@/drizzle/index.js";
import { getColumnCasing } from "@/drizzle/kit/index.js";
import type { Common } from "@/internal/common.js";
import {
  BigIntSerializationError,
  FlushError,
  NotNullConstraintError,
} from "@/internal/errors.js";
import type { Schema, SchemaBuild } from "@/internal/types.js";
import type { Drizzle } from "@/types/db.js";
import { ZERO_CHECKPOINT_STRING } from "@/utils/checkpoint.js";
import { prettyPrint } from "@/utils/print.js";
import {
  type Column,
  type SQL,
  type SQLWrapper,
  type Table,
  type TableConfig,
  and,
  eq,
  getTableColumns,
  getTableName,
  is,
  sql,
} from "drizzle-orm";
import { PgTable, type PgTableWithColumns } from "drizzle-orm/pg-core";

export type IndexingCache = {
  has: ({ table, key }: { table: Table; key: object }) => boolean;
  get: ({
    table,
    key,
    db,
  }: { table: Table; key: object; db: Drizzle<Schema> }) =>
    | { [key: string]: unknown }
    | null
    | Promise<{ [key: string]: unknown } | null>;
  set: ({
    table,
    key,
    row,
    entryType,
  }: {
    table: Table;
    key: object;
    row: { [key: string]: unknown } | null;
    entryType: EntryType;
  }) => { [key: string]: unknown } | null;
  delete: ({
    table,
    key,
    db,
  }: { table: Table; key: object; db: Drizzle<Schema> }) =>
    | boolean
    | Promise<boolean>;
  flush: ({ db }: { db: Drizzle<Schema> }) => Promise<void>;
  bust: () => void;
  size: number;
};

export enum EntryType {
  INSERT = 0,
  UPDATE = 1,
  FIND = 2,
}

type Key = string;
type Entry = {
  type: EntryType;
  bytes: number;
  operationIndex: number;
  row: { [key: string]: unknown } | null;
};
type Cache = Map<Table, Map<Key, Entry>>;

// type Buffer = Map<Table, {
//   event: string;
//   method: string;
//   args: object;
// }[]>;

/**
 * Returns true if the column has a "default" value that is used when no value is passed.
 * Handles `.default`, `.$defaultFn()`, `.$onUpdateFn()`.
 */
export const hasEmptyValue = (column: Column) => {
  return column.hasDefault;
};

/** Returns the "default" value for `column`. */
export const getEmptyValue = (column: Column, type: EntryType) => {
  if (type === EntryType.UPDATE && column.onUpdateFn) {
    return column.onUpdateFn();
  }
  if (column.default !== undefined) return column.default;
  if (column.defaultFn !== undefined) return column.defaultFn();
  if (column.onUpdateFn !== undefined) return column.onUpdateFn();

  // TODO(kyle) is it an invariant that it doesn't get here

  return undefined;
};

export const normalizeColumn = (
  column: Column,
  value: unknown,
  type: EntryType,
  // @ts-ignore
): unknown => {
  if (value === undefined) {
    if (hasEmptyValue(column)) return getEmptyValue(column, type);
    return null;
  }
  if (column.mapToDriverValue === undefined) return value;
  try {
    return column.mapFromDriverValue(column.mapToDriverValue(value));
  } catch (e) {
    if (
      (e as Error)?.message?.includes("Do not know how to serialize a BigInt")
    ) {
      const error = new BigIntSerializationError((e as Error).message);
      error.meta.push(
        "Hint:\n  The JSON column type does not support BigInt values. Use the replaceBigInts() helper function before inserting into the database. Docs: https://ponder.sh/docs/utilities/replace-bigints",
      );
      throw error;
    }
  }
};

export const normalizeRow = (
  table: Table,
  row: { [key: string]: unknown },
  type: EntryType,
) => {
  for (const [columnName, column] of Object.entries(getTableColumns(table))) {
    // not-null constraint
    if (
      type === EntryType.INSERT &&
      (row[columnName] === undefined || row[columnName] === null) &&
      column.notNull &&
      hasEmptyValue(column) === false
    ) {
      const error = new NotNullConstraintError(
        `Column '${getTableName(table)}.${columnName}' violates not-null constraint.`,
      );
      error.meta.push(
        `db.${type === EntryType.INSERT ? "insert" : "update"} arguments:\n${prettyPrint(row)}`,
      );
      throw error;
    }

    row[columnName] = normalizeColumn(column, row[columnName], type);
  }

  return row;
};

export const getCacheKey = (table: Table, key: object): string => {
  const primaryKeys = getPrimaryKeyColumns(table);
  return (
    primaryKeys
      // @ts-ignore
      .map((pk) => normalizeColumn(table[pk.js], key[pk.js]))
      .join("_")
  );
};

/** Returns an sql where condition for `table` with `key`. */
export const getWhereCondition = (table: Table, key: Object): SQL<unknown> => {
  const conditions: SQLWrapper[] = [];

  for (const { js } of getPrimaryKeyColumns(table)) {
    // @ts-ignore
    conditions.push(eq(table[js]!, key[js]));
  }

  return and(...conditions)!;
};

const getBytes = (value: unknown) => {
  // size of metadata
  let size = 13;

  if (typeof value === "number") {
    size += 8;
  } else if (typeof value === "string") {
    size += 2 * value.length;
  } else if (typeof value === "boolean") {
    size += 4;
  } else if (typeof value === "bigint") {
    size += 48;
  } else if (value === null || value === undefined) {
    size += 8;
  } else if (Array.isArray(value)) {
    for (const e of value) {
      size += getBytes(e);
    }
  } else {
    for (const col of Object.values(value)) {
      size += getBytes(col);
    }
  }

  return size;
};

export const createIndexingCache = ({
  common,
  database,
  schemaBuild: { schema },
  checkpoint,
}: {
  common: Common;
  database: Database;
  schemaBuild: Pick<SchemaBuild, "schema">;
  checkpoint: string;
}): IndexingCache => {
  const cache: Cache = new Map();

  let isCacheComplete = checkpoint === ZERO_CHECKPOINT_STRING;
  /** Estimated number of bytes used by cache. */
  let cacheBytes = 0;
  /** LRU counter. */
  let totalCacheOps = 0;

  common.logger.debug({
    service: "indexing",
    msg: `Using a ${Math.round(common.options.indexingCacheMaxBytes / (1024 * 1024))} MB indexing cache`,
  });

  for (const table of Object.values(schema).filter(
    (table): table is PgTableWithColumns<TableConfig> => is(table, PgTable),
  )) {
    cache.set(table, new Map());
  }

  return {
    has({ table, key }) {
      if (isCacheComplete) return true;
      return cache.get(table)!.has(getCacheKey(table, key));
    },
    get({ table, key, db }) {
      const entry = cache.get(table)!.get(getCacheKey(table, key));

      if (entry) {
        entry.operationIndex = totalCacheOps++;

        if (entry.row) {
          return structuredClone(entry.row);
        }
      }

      if (isCacheComplete) {
        return null;
      }

      return database
        .wrap(
          { method: `${getTableName(table) ?? "unknown"}.cache.find()` },
          async () => {
            return db
              .select()
              .from(table)
              .where(getWhereCondition(table, key))
              .then((res) => (res.length === 0 ? null : res[0]!));
          },
        )
        .then((_row) => {
          let row: { [key: string]: unknown } | null;

          if (_row === null) {
            row = null;
          } else {
            row = normalizeRow(table, _row, EntryType.FIND);
          }

          const bytes = getBytes(row);
          cacheBytes += bytes;

          cache.get(table)!.set(getCacheKey(table, key), {
            type: EntryType.FIND,
            bytes,
            operationIndex: totalCacheOps++,
            row: structuredClone(row),
          });
          return row;
        });
    },
    set({ table, key, row: _row, entryType }) {
      let row: { [key: string]: unknown } | null;

      if (_row === null) {
        row = null;
      } else {
        row = normalizeRow(table, _row, entryType);
      }

      if (
        entryType === EntryType.UPDATE &&
        cache.get(table)!.get(getCacheKey(table, _row!))?.type ===
          EntryType.INSERT
      ) {
        entryType = EntryType.INSERT;
      }

      const bytes = getBytes(row);
      cacheBytes += bytes;

      cache.get(table)!.set(getCacheKey(table, key), {
        type: entryType,
        bytes,
        operationIndex: totalCacheOps++,
        row: structuredClone(row),
      });
      return row;
    },
    delete({ table, key, db }) {
      const entry = cache.get(table)!.get(getCacheKey(table, key));

      if (entry) {
        cache.get(table)!.delete(getCacheKey(table, key));

        if (entry.row === null) {
          return false;
        }

        if (isCacheComplete === false) {
          return db
            .delete(table)
            .where(getWhereCondition(table, key))
            .then(() => true);
        }

        return true;
      }

      if (isCacheComplete) {
        return false;
      }

      return db
        .delete(table)
        .where(getWhereCondition(table, key))
        .returning()
        .then((result) => result.length > 0);
    },
    async flush({ db }) {
      let cacheSize = 0;
      for (const c of cache.values()) cacheSize += c.size;

      // prepare: manipulate LRU cache
      // flush: write buffer to db

      const flushIndex =
        totalCacheOps -
        cacheSize * (1 - common.options.indexingCacheFlushRatio);
      const shouldDelete = cacheBytes > common.options.indexingCacheMaxBytes;
      if (shouldDelete) isCacheComplete = false;

      const promises: Promise<void>[] = [];

      for (const [table, tableCache] of cache) {
        const batchSize = Math.round(
          common.options.databaseMaxQueryParameters /
            Object.keys(getTableColumns(table)).length,
        );

        const insertValues: Entry["row"][] = [];
        const updateValues: Entry["row"][] = [];

        for (const [key, entry] of tableCache) {
          if (entry.type === EntryType.INSERT) {
            insertValues.push(entry.row);
          }

          if (entry.type === EntryType.UPDATE) {
            updateValues.push(entry.row);
          }

          // delete so that object is eligible for GC
          if (shouldDelete && entry.operationIndex < flushIndex) {
            tableCache.delete(key);
            cacheBytes -= entry.bytes;
          }

          entry.type = EntryType.FIND;
        }

        if (insertValues.length > 0) {
          common.logger.debug({
            service: "indexing",
            msg: `Inserting ${insertValues.length} cached '${getTableName(table)}' rows into the database`,
          });

          while (insertValues.length > 0) {
            const values = insertValues.splice(0, batchSize);
            promises.push(
              database.wrap(
                { method: `${getTableName(table)}.flush()` },
                async () => {
                  await db
                    .insert(table)
                    .values(values)
                    .catch((_error) => {
                      const error = _error as Error;
                      common.logger.error({
                        service: "indexing",
                        msg: "Internal error occurred while flushing cache. Please report this error here: https://github.com/ponder-sh/ponder/issues",
                      });
                      throw new FlushError(error.message);
                    });
                },
              ),
            );
          }
        }

        if (updateValues.length > 0) {
          common.logger.debug({
            service: "indexing",
            msg: `Updating ${updateValues.length} cached '${getTableName(table)}' rows in the database`,
          });

          const primaryKeys = getPrimaryKeyColumns(table);
          const set: { [column: string]: SQL } = {};

          for (const [columnName, column] of Object.entries(
            getTableColumns(table),
          )) {
            set[columnName] = sql.raw(
              `excluded."${getColumnCasing(column, "snake_case")}"`,
            );
          }

          while (updateValues.length > 0) {
            const values = updateValues.splice(0, batchSize);
            promises.push(
              database.wrap(
                {
                  method: `${getTableName(table)}.flush()`,
                },
                async () => {
                  await db
                    .insert(table)
                    .values(values)
                    .onConflictDoUpdate({
                      // @ts-ignore
                      target: primaryKeys.map(({ js }) => table[js]),
                      set,
                    })
                    .catch((_error) => {
                      const error = _error as Error;
                      common.logger.error({
                        service: "indexing",
                        msg: "Internal error occurred while flushing cache. Please report this error here: https://github.com/ponder-sh/ponder/issues",
                      });
                      throw new FlushError(error.message);
                    });
                },
              ),
            );
          }
        }
      }

      await Promise.all(promises);
    },
    bust() {
      isCacheComplete = false;
    },
    get size() {
      return cacheBytes;
    },
  };
};
