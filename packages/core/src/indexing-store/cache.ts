import type { Database } from "@/database/index.js";
import { getTableNames } from "@/drizzle/index.js";
import { getPrimaryKeyColumns } from "@/drizzle/index.js";
import { getColumnCasing } from "@/drizzle/kit/index.js";
import type { Common } from "@/internal/common.js";
import {
  BigIntSerializationError,
  FlushError,
  NotNullConstraintError,
} from "@/internal/errors.js";
import type { SchemaBuild } from "@/internal/types.js";
import { ZERO_CHECKPOINT_STRING } from "@/utils/checkpoint.js";
import { prettyPrint } from "@/utils/print.js";
import {
  type Column,
  type SQL,
  type Table,
  getTableColumns,
  getTableName,
  sql,
} from "drizzle-orm";

export type IndexingCache = {
  has: (table: Table, key: object) => boolean;
  // TODO(kyle) should `get` make a database query?
  get: (table: Table, key: object) => { [key: string]: unknown } | null;
  set: (
    table: Table,
    key: object,
    row: { [key: string]: unknown } | null,
    entryType: EntryType,
  ) => { [key: string]: unknown } | null;
  delete: (table: Table, key: object) => boolean;
  isCacheComplete: () => boolean;
  size: number;
  flush: () => Promise<void>;
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

  for (const tableName of getTableNames(schema)) {
    cache.set(schema[tableName.js] as Table, new Map());
  }

  const getCacheKey = (table: Table, key: object): string => {
    const primaryKeys = getPrimaryKeyColumns(table);
    return (
      primaryKeys
        // @ts-ignore
        .map((pk) => normalizeColumn(table[pk.js], key[pk.js]))
        .join("_")
    );
  };

  return {
    has(table, row) {
      return cache.get(table)!.has(getCacheKey(table, row));
    },
    get(table, row) {
      // TODO(kyle) touch
      return cache.get(table)!.get(getCacheKey(table, row))?.row ?? null;
    },
    set(table, key, _row, entryType) {
      let row: { [key: string]: unknown } | null;

      if (_row === null) {
        row = null;
      } else {
        row = normalizeRow(table, structuredClone(_row), entryType);
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
        row,
      });

      // TODO(kyle) how to do only one copy?
      return structuredClone(row);
    },
    delete(table, key) {
      const entry = cache.get(table)!.get(getCacheKey(table, key));
      if (entry) {
        cacheBytes -= entry!.bytes;
        cache.get(table)!.delete(getCacheKey(table, key));
        return true;
      } else {
        return false;
      }
    },
    isCacheComplete() {
      return isCacheComplete;
    },
    get size() {
      return cacheBytes;
    },
    async flush() {
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
                  await database.qb.drizzle
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
                  await database.qb.drizzle
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
      // });
    },
  };
};

// isCacheFull() {
//   return cacheBytes > maxBytes;
// },
