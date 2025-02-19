import type { Database } from "@/database/index.js";
import { getPrimaryKeyColumns } from "@/drizzle/index.js";
import { getColumnCasing } from "@/drizzle/kit/index.js";
import type { Common } from "@/internal/common.js";
import {
  BigIntSerializationError,
  NotNullConstraintError,
} from "@/internal/errors.js";
import type { Schema, SchemaBuild } from "@/internal/types.js";
import type { Drizzle } from "@/types/db.js";
import { ZERO_CHECKPOINT_STRING } from "@/utils/checkpoint.js";
import { chunk } from "@/utils/chunk.js";
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
import { PgArray, PgTable, type PgTableWithColumns } from "drizzle-orm/pg-core";
import { parseSqlError } from "./index.js";

export type IndexingCache = {
  /**
   * Returns true if the cache has an entry for `table` with `key`.
   */
  has: (params: { table: Table; key: object }) => boolean;
  /**
   * Returns the entry for `table` with `key`.
   */
  get: (params: { table: Table; key: object; db: Drizzle<Schema> }) =>
    | { [key: string]: unknown }
    | null
    | Promise<{ [key: string]: unknown } | null>;
  /**
   * Sets the entry for `table` with `key` to `row`.
   */
  set: (params: {
    table: Table;
    key: object;
    row: { [key: string]: unknown };
    isUpdate: boolean;
  }) => { [key: string]: unknown };
  /**
   * Deletes the entry for `table` with `key`.
   */
  delete: (params: { table: Table; key: object; db: Drizzle<Schema> }) =>
    | boolean
    | Promise<boolean>;
  /**
   * Writes all temporary data to the database.
   */
  flush: (params: { db: Drizzle<Schema> }) => Promise<void>;
  /**
   * Make all temporary data permanent and prepare the cache for
   * the next iteration.
   *
   * Note: It is assumed this is called after `flush`
   * because it clears the buffers.
   */
  commit: () => void;
  /**
   * Remove spillover and buffer entries.
   */
  rollback: () => void;
  /**
   * Marks the cache as incomplete.
   */
  invalidate: () => void;
  /**
   * Deletes all entries from the cache.
   */
  clear: () => void;
};

type Cache = Map<
  Table,
  Map<
    string,
    {
      bytes: number;
      operationIndex: number;
      row: { [key: string]: unknown } | null;
    }
  >
>;

type Buffer = Map<
  Table,
  Map<
    string,
    {
      row: { [key: string]: unknown };
    }
  >
>;

/**
 * Returns true if the column has a "default" value that is used when no value is passed.
 * Handles `.default`, `.$defaultFn()`, `.$onUpdateFn()`.
 */
export const hasEmptyValue = (column: Column) => {
  return column.hasDefault;
};

/** Returns the "default" value for `column`. */
export const getEmptyValue = (column: Column, isUpdate: boolean) => {
  if (isUpdate && column.onUpdateFn) {
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
  isUpdate: boolean,
  // @ts-ignore
): unknown => {
  if (value === undefined) {
    if (hasEmptyValue(column)) return getEmptyValue(column, isUpdate);
    return null;
  }
  if (value === null) return null;
  if (column.mapToDriverValue === undefined) return value;
  try {
    if (Array.isArray(value) && column instanceof PgArray) {
      return value.map((v) =>
        column.baseColumn.mapFromDriverValue(
          column.baseColumn.mapToDriverValue(v),
        ),
      );
    }

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
  isUpdate: boolean,
) => {
  for (const [columnName, column] of Object.entries(getTableColumns(table))) {
    // not-null constraint
    if (
      isUpdate === false &&
      (row[columnName] === undefined || row[columnName] === null) &&
      column.notNull &&
      hasEmptyValue(column) === false
    ) {
      const error = new NotNullConstraintError(
        `Column '${getTableName(table)}.${columnName}' violates not-null constraint.`,
      );
      error.meta.push(`db.insert arguments:\n${prettyPrint(row)}`);
      throw error;
    }

    row[columnName] = normalizeColumn(column, row[columnName], isUpdate);
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
  const spillover: Cache = new Map();
  const insertBuffer: Buffer = new Map();
  const updateBuffer: Buffer = new Map();

  let isCacheComplete = checkpoint === ZERO_CHECKPOINT_STRING;

  let cacheBytes = 0;
  let spilloverBytes = 0;

  // LRU counter
  let totalCacheOps = 0;

  common.logger.debug({
    service: "indexing",
    msg: `Using a ${Math.round(common.options.indexingCacheMaxBytes / (1024 * 1024))} MB indexing cache`,
  });

  for (const table of Object.values(schema).filter(
    (table): table is PgTableWithColumns<TableConfig> => is(table, PgTable),
  )) {
    cache.set(table, new Map());
    spillover.set(table, new Map());
    insertBuffer.set(table, new Map());
    updateBuffer.set(table, new Map());
  }

  return {
    has({ table, key }) {
      if (isCacheComplete) return true;

      return (
        cache.get(table)!.has(getCacheKey(table, key)) ??
        spillover.get(table)!.has(getCacheKey(table, key)) ??
        insertBuffer.get(table)!.has(getCacheKey(table, key)) ??
        updateBuffer.get(table)!.has(getCacheKey(table, key))
      );
    },
    get({ table, key, db }) {
      // Note: order is important, it is an invariant that update entries
      // are prioritized over insert entries
      const bufferEntry =
        updateBuffer.get(table)!.get(getCacheKey(table, key)) ??
        insertBuffer.get(table)!.get(getCacheKey(table, key));

      if (bufferEntry) {
        return structuredClone(bufferEntry.row);
      }

      const entry =
        spillover.get(table)!.get(getCacheKey(table, key)) ??
        cache.get(table)!.get(getCacheKey(table, key));

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
        .record(
          {
            method: `${getTableName(table) ?? "unknown"}.cache.find()`,
          },
          async () => {
            return db
              .select()
              .from(table)
              .where(getWhereCondition(table, key))
              .then((res) => (res.length === 0 ? null : res[0]!));
          },
        )
        .then((row) => {
          const bytes = getBytes(row);
          spilloverBytes += bytes;

          spillover.get(table)!.set(getCacheKey(table, key), {
            bytes,
            operationIndex: totalCacheOps++,
            row: structuredClone(row),
          });
          return row;
        });
    },
    set({ table, key, row: _row, isUpdate }) {
      const row = normalizeRow(table, _row, isUpdate);

      if (isUpdate) {
        updateBuffer.get(table)!.set(getCacheKey(table, key), {
          row: structuredClone(row),
        });
      } else {
        insertBuffer.get(table)!.set(getCacheKey(table, key), {
          row: structuredClone(row),
        });
      }

      return row;
    },
    async delete({ table, key, db }) {
      const ck = getCacheKey(table, key);

      const inInsertBuffer = insertBuffer.get(table)!.delete(ck);
      const inUpdateBuffer = updateBuffer.get(table)!.delete(ck);

      cache.get(table)!.delete(ck);
      spillover.get(table)!.delete(ck);

      const inDb = await db
        .delete(table)
        .where(getWhereCondition(table, key))
        .returning()
        .then((result) => result.length > 0);

      return inInsertBuffer || inUpdateBuffer || inDb;
    },
    async flush({ db }) {
      for (const table of cache.keys()) {
        const batchSize = Math.round(
          common.options.databaseMaxQueryParameters /
            Object.keys(getTableColumns(table)).length,
        );

        const tableSpillover = spillover.get(table)!;

        const insertValues = Array.from(insertBuffer.get(table)!.values());
        const updateValues = Array.from(updateBuffer.get(table)!.values());

        if (insertValues.length > 0) {
          for (const insertChunk of chunk(insertValues, batchSize)) {
            await database.record(
              { method: `${getTableName(table)}.flush()` },
              async () => {
                await db
                  .insert(table)
                  .values(insertChunk.map(({ row }) => row))
                  .catch((error) => {
                    throw parseSqlError(error);
                  });
              },
            );
          }

          for (const [key, entry] of insertBuffer.get(table)!) {
            const bytes = getBytes(entry.row);
            cacheBytes += bytes;
            tableSpillover.set(key, {
              bytes,
              operationIndex: totalCacheOps++,
              row: entry.row,
            });
          }
          insertBuffer.get(table)!.clear();

          common.logger.debug({
            service: "database",
            msg: `Inserted ${insertValues.length} '${getTableName(table)}' rows`,
          });
        }

        if (updateValues.length > 0) {
          const primaryKeys = getPrimaryKeyColumns(table);
          const set: { [column: string]: SQL } = {};

          for (const [columnName, column] of Object.entries(
            getTableColumns(table),
          )) {
            set[columnName] = sql.raw(
              `excluded."${getColumnCasing(column, "snake_case")}"`,
            );
          }

          for (const updateChunk of chunk(updateValues, batchSize)) {
            await database.record(
              {
                method: `${getTableName(table)}.flush()`,
              },
              async () => {
                await db
                  .insert(table)
                  .values(updateChunk.map(({ row }) => row))
                  .onConflictDoUpdate({
                    // @ts-ignore
                    target: primaryKeys.map(({ js }) => table[js]),
                    set,
                  })
                  .catch((error) => {
                    throw parseSqlError(error);
                  });
              },
            );
          }

          for (const [key, entry] of updateBuffer.get(table)!) {
            const bytes = getBytes(entry.row);
            cacheBytes += bytes;
            tableSpillover.set(key, {
              bytes,
              operationIndex: totalCacheOps++,
              row: entry.row,
            });
          }
          updateBuffer.get(table)!.clear();

          common.logger.debug({
            service: "database",
            msg: `Updated ${updateValues.length} '${getTableName(table)}' rows`,
          });
        }
      }
    },
    commit() {
      for (const [table, tableSpillover] of spillover) {
        const tableCache = cache.get(table)!;
        for (const [key, entry] of tableSpillover) {
          tableCache.set(key, entry);
        }
        tableSpillover.clear();
      }

      cacheBytes += spilloverBytes;
      spilloverBytes = 0;

      let cacheSize = 0;
      for (const { size } of cache.values()) cacheSize += size;

      const flushIndex =
        totalCacheOps -
        cacheSize * (1 - common.options.indexingCacheEvictRatio);

      if (cacheBytes + spilloverBytes > common.options.indexingCacheMaxBytes) {
        isCacheComplete = false;

        let rowCount = 0;

        for (const tableCache of cache.values()) {
          for (const [key, entry] of tableCache) {
            if (entry.operationIndex < flushIndex) {
              tableCache.delete(key);
              cacheBytes -= entry.bytes;
              rowCount += 1;
            }
          }
        }

        common.logger.debug({
          service: "indexing",
          msg: `Evicted ${rowCount} rows from the cache`,
        });
      }
    },
    invalidate() {
      isCacheComplete = false;
    },
    rollback() {
      for (const tableSpillover of spillover.values()) {
        tableSpillover.clear();
      }

      for (const tableBuffer of insertBuffer.values()) {
        tableBuffer.clear();
      }

      for (const tableBuffer of updateBuffer.values()) {
        tableBuffer.clear();
      }

      spilloverBytes = 0;
    },
    clear() {
      for (const tableCache of cache.values()) {
        tableCache.clear();
      }

      for (const tableSpillover of spillover.values()) {
        tableSpillover.clear();
      }

      for (const tableBuffer of insertBuffer.values()) {
        tableBuffer.clear();
      }

      for (const tableBuffer of updateBuffer.values()) {
        tableBuffer.clear();
      }

      cacheBytes = 0;
      spilloverBytes = 0;
    },
  };
};
