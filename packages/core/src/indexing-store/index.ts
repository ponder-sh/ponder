import type { Common } from "@/common/common.js";
import {
  BigIntSerializationError,
  CheckConstraintError,
  FlushError,
  InvalidStoreMethodError,
  NotNullConstraintError,
  RecordNotFoundError,
  UndefinedTableError,
  UniqueConstraintError,
  getBaseError,
} from "@/common/errors.js";
import type { Database } from "@/database/index.js";
import {
  type Schema,
  getPrimaryKeyColumns,
  getTableNames,
  onchain,
} from "@/drizzle/index.js";
import { getColumnCasing } from "@/drizzle/kit/index.js";
import type { Db } from "@/types/db.js";
import { encodeCheckpoint, zeroCheckpoint } from "@/utils/checkpoint.js";
import { prettyPrint } from "@/utils/print.js";
import {
  type Column,
  type QueryWithTypings,
  type SQL,
  type Table,
  and,
  eq,
  getTableColumns,
  sql,
} from "drizzle-orm";
import {
  PgBigSerial53,
  PgBigSerial64,
  PgSerial,
  PgSmallSerial,
  type PgTable,
  getTableConfig,
} from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pg-proxy";
import { createQueue } from "../../../common/src/queue.js";

export type IndexingStore = Db<Schema> & {
  /**
   * Persist the cache to the database.
   */
  flush: () => Promise<void>;
  isCacheFull: () => boolean;
  setPolicy: (policy: "historical" | "realtime") => void;
};

enum EntryType {
  INSERT = 0,
  UPDATE = 1,
  FIND = 2,
}

/** Cache entries that need to be created in the database. */
type InsertEntry = {
  type: EntryType.INSERT;
  bytes: number;
  operationIndex: number;
  row: { [key: string]: unknown };
};

/** Cache entries that need to be updated in the database. */
type UpdateEntry = {
  type: EntryType.UPDATE;
  bytes: number;
  operationIndex: number;
  row: { [key: string]: unknown };
};

/**
 * Cache entries that mirror the database. Can be `null`,
 * meaning the entry doesn't exist.
 */
export type FindEntry = {
  type: EntryType.FIND;
  bytes: number;
  operationIndex: number;
  row: { [key: string]: unknown } | typeof empty;
};

// TODO(kyle) key interning
type Key = string;
type Entry = InsertEntry | UpdateEntry | FindEntry;
type Cache = Map<Table, Map<Key, Entry>>;

/** Empty state for indexing store */
export const empty = null;

/** Returns an sql where condition for `table` with `key`. */
const getWhereCondition = (table: Table, key: Object): SQL<unknown> => {
  // @ts-ignore
  return and(
    // @ts-ignore
    ...Object.entries(key).map(([column, value]) => eq(table[column], value)),
  );
};

/** Throw an error if `table` is not an `onchainTable`. */
const checkOnchainTable = (
  table: Table,
  method: "find" | "insert" | "update" | "upsert" | "delete",
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

export const createIndexingStore = ({
  common,
  database,
  schema,
  initialCheckpoint,
}: {
  common: Common;
  database: Database;
  schema: Schema;
  initialCheckpoint: string;
}): IndexingStore => {
  // Operation queue to make sure all queries are run in order, circumventing race conditions
  const queue = createQueue<unknown, () => Promise<unknown>>({
    browser: false,
    initialStart: true,
    concurrency: 1,
    worker: (fn) => {
      return fn();
    },
  });

  const tableNameCache: Map<Table, string> = new Map();
  const primaryKeysCache: Map<Table, { sql: string; js: string }[]> = new Map();
  const isSerialTableCache: Map<Table, boolean> = new Map();
  const cache: Cache = new Map();

  const isSerialTable = (table: Table) => {
    const primaryKeys = primaryKeysCache.get(table)!;

    const maybeSerialColumn = getTableColumns(table)[primaryKeys[0]!.js]!;
    if (
      primaryKeys.length === 1 &&
      (maybeSerialColumn instanceof PgSerial ||
        maybeSerialColumn instanceof PgSmallSerial ||
        maybeSerialColumn instanceof PgBigSerial53 ||
        maybeSerialColumn instanceof PgBigSerial64)
    ) {
      return true;
    }

    return false;
  };

  for (const tableName of getTableNames(schema, "")) {
    primaryKeysCache.set(
      schema[tableName.js] as Table,
      getPrimaryKeyColumns(schema[tableName.js] as PgTable),
    );
    isSerialTableCache.set(
      schema[tableName.js] as Table,
      isSerialTable(schema[tableName.js] as Table),
    );
    cache.set(schema[tableName.js] as Table, new Map());
    tableNameCache.set(schema[tableName.js] as Table, tableName.user);
  }

  ////////
  // Helper functions
  ////////

  const getCacheKey = (
    table: Table,
    row: { [key: string]: unknown },
  ): string => {
    const primaryKeys = primaryKeysCache.get(table)!;

    if (isSerialTableCache.get(table)) {
      return `_serial_${totalCacheOps}`;
    }

    return (
      primaryKeys
        // @ts-ignore
        .map((pk) => normalizeColumn(table[pk.js], row[pk.js]))
        .join("_")
    );
  };

  const getCacheEntry = (table: Table, row: { [key: string]: unknown }) => {
    return cache.get(table)!.get(getCacheKey(table, row));
  };

  const setCacheEntry = (
    table: Table,
    userRow: { [key: string]: unknown },
    entryType: Exclude<EntryType, { type: EntryType.FIND }>,
    existingRow?: { [key: string]: unknown },
  ): { [key: string]: unknown } => {
    let row = structuredClone(userRow);

    if (existingRow) {
      for (const [key, value] of Object.entries(row)) {
        existingRow[key] = value;
      }
      existingRow = normalizeRow(table, existingRow, entryType);
      const bytes = getBytes(existingRow);

      cacheSize += 1;
      cacheBytes += bytes;

      cache.get(table)!.set(getCacheKey(table, existingRow), {
        type: entryType,
        row: existingRow,
        operationIndex: totalCacheOps++,
        bytes,
      });

      return structuredClone(existingRow);
    } else {
      row = normalizeRow(table, row, entryType);
      const bytes = getBytes(row);

      cacheSize += 1;
      cacheBytes += bytes;

      cache.get(table)!.set(getCacheKey(table, row), {
        type: entryType,
        bytes,
        operationIndex: totalCacheOps++,
        row,
      });

      return structuredClone(row);
    }
  };

  const deleteCacheEntry = (table: Table, row: { [key: string]: unknown }) => {
    const entry = getCacheEntry(table, row);
    if (entry) {
      cacheBytes -= entry!.bytes;
      cacheSize -= 1;
    }
    return cache.get(table)!.delete(getCacheKey(table, row));
  };

  /**
   * Returns true if the column has a "default" value that is used when no value is passed.
   * Handles `.default`, `.serial`, `.$defaultFn()`, `.$onUpdateFn()`.
   */
  const hasEmptyValue = (column: Column) => {
    return column.hasDefault;
  };

  /**
   * Returns the "default" value for `column`.
   */
  const getEmptyValue = (column: Column, type: EntryType) => {
    if (type === EntryType.UPDATE && column.onUpdateFn) {
      return column.onUpdateFn();
    }
    if (column.default) return column.default;
    if (column.defaultFn) return column.defaultFn();
    if (column.onUpdateFn) return column.onUpdateFn();

    return undefined;
  };

  const normalizeRow = (
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
          `Column '${tableNameCache.get(table)}.${columnName}' violates not-null constraint.`,
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

  const normalizeColumn = (
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

  /** Throw an error if `table` has a `serial` primary key and `method` is unsupported. */
  const checkSerialTable = (
    table: Table,
    method: "find" | "insert" | "update" | "upsert" | "delete",
  ) => {
    if (method === "insert" || isSerialTableCache.get(table) === false) return;

    throw new InvalidStoreMethodError(
      `db.${method}(${tableNameCache.get(table)}) cannot be used on tables with serial primary keys`,
    );
  };

  let isDatabaseEmpty = initialCheckpoint === encodeCheckpoint(zeroCheckpoint);
  let isHistoricalBackfill = true;
  /** Number of entries in cache. */
  let cacheSize = 0;
  /** Estimated number of bytes used by cache. */
  let cacheBytes = 0;
  /** LRU counter. */
  let totalCacheOps = 0;

  const maxBytes = common.options.indexingCacheMaxBytes;
  common.logger.debug({
    service: "indexing",
    msg: `Using a ${Math.round(maxBytes / (1024 * 1024))} MB indexing cache`,
  });

  const find = (table: Table, key: object) => {
    return database.drizzle
      .select()
      .from(table as PgTable)
      .where(getWhereCondition(table as PgTable, key))
      .then((res) => (res.length === 0 ? null : res[0]!));
  };

  // @ts-ignore
  const indexingStore = {
    // @ts-ignore
    find: (table: Table, key) =>
      queue.add(() =>
        database.qb.user.wrap(
          { method: `${tableNameCache.get(table) ?? "unknown"}.find()` },
          async () => {
            checkOnchainTable(table as Table, "find");
            checkSerialTable(table as Table, "find");

            const entry = getCacheEntry(table, key);

            if (entry) {
              // update lru ordering
              getCacheEntry(table, key)!.operationIndex = totalCacheOps++;

              return entry.row;
            } else {
              if (isDatabaseEmpty) return null;

              const row = await find(table, key);
              const bytes = getBytes(row);

              cacheSize += 1;
              cacheBytes += bytes;

              cache.get(table)!.set(getCacheKey(table, key), {
                type: EntryType.FIND,
                bytes,
                operationIndex: totalCacheOps++,
                row,
              });

              return find(table, key);
            }
          },
        ),
      ),
    // @ts-ignore
    insert(table: Table) {
      return {
        values: (values: any) =>
          queue.add(() =>
            database.qb.user.wrap(
              { method: `${tableNameCache.get(table) ?? "unknown"}.insert()` },
              async () => {
                checkOnchainTable(table as Table, "insert");
                checkSerialTable(table as Table, "insert");

                const isSerialTable = isSerialTableCache.get(table);

                if (Array.isArray(values)) {
                  const rows = [];
                  for (const value of values) {
                    if (
                      isSerialTable === false &&
                      getCacheEntry(table, value)?.row
                    ) {
                      const error = new UniqueConstraintError(
                        `Unique constraint failed for '${tableNameCache.get(table)}'.`,
                      );
                      error.meta.push(
                        `db.insert arguments:\n${prettyPrint(value)}`,
                      );
                      throw error;
                    } else if (
                      isSerialTable === false &&
                      isDatabaseEmpty === false
                    ) {
                      const findResult = await find(table, value);

                      if (findResult) {
                        const error = new UniqueConstraintError(
                          `Unique constraint failed for '${tableNameCache.get(table)}'.`,
                        );
                        error.meta.push(
                          `db.insert arguments:\n${prettyPrint(value)}`,
                        );
                        throw error;
                      }
                    }

                    rows.push(setCacheEntry(table, value, EntryType.INSERT));
                  }
                  return rows;
                } else {
                  if (
                    isSerialTable === false &&
                    getCacheEntry(table, values)?.row
                  ) {
                    const error = new UniqueConstraintError(
                      `Unique constraint failed for '${tableNameCache.get(table)}'.`,
                    );
                    error.meta.push(
                      `db.insert arguments:\n${prettyPrint(values)}`,
                    );
                    throw error;
                  } else if (
                    isSerialTable === false &&
                    isDatabaseEmpty === false
                  ) {
                    const findResult = await find(table, values);

                    if (findResult) {
                      const error = new UniqueConstraintError(
                        `Unique constraint failed for '${tableNameCache.get(table)}'.`,
                      );
                      error.meta.push(
                        `db.insert arguments:\n${prettyPrint(values)}`,
                      );
                      throw error;
                    }
                  }

                  return setCacheEntry(table, values, EntryType.INSERT);
                }
              },
            ),
          ),
      };
    },
    // @ts-ignore
    update(table: Table, key) {
      return {
        set: (values: any) =>
          queue.add(() =>
            database.qb.user.wrap(
              { method: `${tableNameCache.get(table) ?? "unknown"}.update()` },
              async () => {
                checkOnchainTable(table as Table, "update");
                checkSerialTable(table as Table, "update");

                const entry = getCacheEntry(table, key);
                deleteCacheEntry(table, key);

                let row: { [key: string]: unknown };

                if (entry?.row) {
                  row = entry.row;
                } else {
                  if (isDatabaseEmpty) {
                    const error = new RecordNotFoundError(
                      `No existing record found in table '${tableNameCache.get(table)}'`,
                    );
                    error.meta.push(
                      `db.update arguments:\n${prettyPrint(values)}`,
                    );
                    throw error;
                  }

                  const findResult = await find(table, key);

                  if (findResult) {
                    row = findResult;
                  } else {
                    const error = new RecordNotFoundError(
                      `No existing record found in table '${tableNameCache.get(table)}'`,
                    );
                    error.meta.push(
                      `db.update arguments:\n${prettyPrint(values)}`,
                    );
                    throw error;
                  }
                }

                if (typeof values === "function") {
                  return setCacheEntry(
                    table,
                    values(row),
                    entry?.type === EntryType.INSERT
                      ? EntryType.INSERT
                      : EntryType.UPDATE,
                    row,
                  );
                } else {
                  return setCacheEntry(
                    table,
                    values,
                    entry?.type === EntryType.INSERT
                      ? EntryType.INSERT
                      : EntryType.UPDATE,
                    row,
                  );
                }
              },
            ),
          ),
      };
    },
    // @ts-ignore
    upsert(table: Table, key) {
      return {
        insert(valuesI: any) {
          return {
            update: (valuesU: any) =>
              queue.add(() =>
                database.qb.user.wrap(
                  {
                    method: `${tableNameCache.get(table) ?? "unknown"}.upsert()`,
                  },
                  async () => {
                    checkOnchainTable(table as Table, "upsert");
                    checkSerialTable(table as Table, "upsert");

                    const entry = getCacheEntry(table, key);
                    deleteCacheEntry(table, key);

                    let row: { [key: string]: unknown } | typeof empty;

                    if (entry?.row) {
                      row = entry.row;
                    } else {
                      if (isDatabaseEmpty) row = null;
                      else row = await find(table, key);
                    }

                    if (row === null) {
                      return setCacheEntry(
                        table,
                        valuesI,
                        EntryType.INSERT,
                        key,
                      );
                    } else {
                      if (typeof valuesU === "function") {
                        return setCacheEntry(
                          table,
                          valuesU(row),
                          entry?.type === EntryType.INSERT
                            ? EntryType.INSERT
                            : EntryType.UPDATE,
                          row,
                        );
                      } else {
                        return setCacheEntry(
                          table,
                          valuesU,
                          entry?.type === EntryType.INSERT
                            ? EntryType.INSERT
                            : EntryType.UPDATE,
                          row,
                        );
                      }
                    }
                  },
                ),
              ),
            // biome-ignore lint/suspicious/noThenProperty: <explanation>
            then: <TResult1 = void, TResult2 = never>(
              onFulfilled?:
                | ((value: void) => TResult1 | PromiseLike<TResult1>)
                | undefined
                | null,
              onRejected?:
                | ((reason: any) => TResult2 | PromiseLike<TResult2>)
                | undefined
                | null,
            ) =>
              queue
                .add(() =>
                  database.qb.user.wrap(
                    {
                      method: `${tableNameCache.get(table) ?? "unknown"}.upsert()`,
                    },
                    async () => {
                      checkOnchainTable(table as Table, "upsert");
                      checkSerialTable(table as Table, "upsert");

                      const entry = getCacheEntry(table, key);

                      let row: { [key: string]: unknown } | null;

                      if (entry?.row) {
                        row = entry.row;
                      } else {
                        if (isDatabaseEmpty) row = null;
                        else row = await find(table, key);
                      }

                      if (row === null) {
                        return setCacheEntry(
                          table,
                          valuesI,
                          EntryType.INSERT,
                          key,
                        );
                      }

                      return null;
                    },
                  ),
                )
                // @ts-ignore
                .then(onFulfilled, onRejected),
          };
        },
        update(valuesU: any) {
          return {
            insert: (valuesI: any) =>
              indexingStore.upsert(table, key).insert(valuesI).update(valuesU),
            // biome-ignore lint/suspicious/noThenProperty: <explanation>
            then: <TResult1 = void, TResult2 = never>(
              onFulfilled?:
                | ((value: void) => TResult1 | PromiseLike<TResult1>)
                | undefined
                | null,
              onRejected?:
                | ((reason: any) => TResult2 | PromiseLike<TResult2>)
                | undefined
                | null,
            ) =>
              queue
                .add(() =>
                  database.qb.user.wrap(
                    {
                      method: `${tableNameCache.get(table) ?? "unknown"}.upsert()`,
                    },
                    async () => {
                      checkOnchainTable(table as Table, "upsert");
                      checkSerialTable(table as Table, "upsert");

                      const entry = getCacheEntry(table, key);
                      deleteCacheEntry(table, key);

                      let row: { [key: string]: unknown } | null;

                      if (entry?.row) {
                        row = entry.row;
                      } else {
                        if (isDatabaseEmpty) row = null;
                        else row = await find(table, key);
                      }

                      if (row) {
                        if (typeof valuesU === "function") {
                          return setCacheEntry(
                            table,
                            valuesU(row),
                            entry?.type === EntryType.INSERT
                              ? EntryType.INSERT
                              : EntryType.UPDATE,
                            row,
                          );
                        } else {
                          return setCacheEntry(
                            table,
                            valuesU,
                            entry?.type === EntryType.INSERT
                              ? EntryType.INSERT
                              : EntryType.UPDATE,
                            row,
                          );
                        }
                      }
                      return null;
                    },
                  ),
                )
                // @ts-ignore
                .then(onFulfilled, onRejected),
          };
        },
      };
    },
    // @ts-ignore
    delete: (table: Table, key) =>
      queue.add(() =>
        database.qb.user.wrap(
          { method: `${tableNameCache.get(table) ?? "unknown"}.delete()` },
          async () => {
            checkOnchainTable(table as Table, "upsert");
            checkSerialTable(table as Table, "upsert");

            const entry = getCacheEntry(table, key);
            deleteCacheEntry(table, key);

            if (entry?.row) {
              if (entry.type === EntryType.INSERT) {
                return true;
              }

              await database.drizzle
                .delete(table as Table)
                .where(getWhereCondition(table as Table, key));

              return true;
            } else {
              if (isDatabaseEmpty) {
                return false;
              }

              const deleteResult = await database.drizzle
                .delete(table as Table)
                .where(getWhereCondition(table as Table, key))
                .returning();

              return deleteResult.length > 0;
            }
          },
        ),
      ),
    // @ts-ignore
    sql: drizzle(
      async (_sql, params, method, typings) => {
        if (isHistoricalBackfill) await database.createTriggers();
        await indexingStore.flush();
        if (isHistoricalBackfill) await database.removeTriggers();

        const query: QueryWithTypings = { sql: _sql, params, typings };

        const res = await database.qb.user
          .wrap({ method: "sql" }, () =>
            database.drizzle._.session
              .prepareQuery(query, undefined, undefined, method === "all")
              .execute()
              .catch((e) => {
                let error = getBaseError(e);

                if (error?.message?.includes("violates not-null constraint")) {
                  error = new NotNullConstraintError(error.message);
                } else if (
                  error?.message?.includes("violates unique constraint")
                ) {
                  error = new UniqueConstraintError(error.message);
                } else if (
                  error?.message.includes("violates check constraint")
                ) {
                  error = new CheckConstraintError(error.message);
                } else if (
                  error?.message?.includes(
                    "Do not know how to serialize a BigInt",
                  )
                ) {
                  error = new BigIntSerializationError(error.message);
                  error.meta.push(
                    "Hint:\n  The JSON column type does not support BigInt values. Use the replaceBigInts() helper function before inserting into the database. Docs: https://ponder.sh/docs/utilities/replace-bigints",
                  );
                }

                throw error;
              }),
          )
          .catch((error) => {
            Error.captureStackTrace(error);
            throw error;
          });

        // @ts-ignore
        return { rows: res.rows.map((row) => Object.values(row)) };
      },
      { schema, casing: "snake_case" },
    ),
    async flush() {
      await queue.add(async () => {
        const promises: Promise<any>[] = [];

        for (const [table, tableCache] of cache) {
          const entries = Array.from(tableCache.values());

          const batchSize = Math.round(
            common.options.databaseMaxQueryParameters /
              Object.keys(getTableColumns(table)).length,
          );

          const insertValues = entries
            .filter((e) => e.type === EntryType.INSERT)
            .map((e) => e.row);

          const updateValues = entries
            .filter((e) => e.type === EntryType.UPDATE)
            .map((e) => e.row);

          if (insertValues.length > 0) {
            common.logger.debug({
              service: "indexing",
              msg: `Inserting ${insertValues.length} cached '${tableNameCache.get(table)}' rows into the database`,
            });

            for (
              let i = 0, len = insertValues.length;
              i < len;
              i += batchSize
            ) {
              promises.push(
                database.qb.user.wrap(
                  {
                    method: `${tableNameCache.get(table)}.flush()`,
                  },
                  async () =>
                    await database.drizzle
                      .insert(table)
                      .values(insertValues.slice(i, i + batchSize))
                      .catch((_error) => {
                        const error = _error as Error;
                        common.logger.error({
                          service: "indexing",
                          msg: "Internal error occurred while flushing cache. Please report this error here: https://github.com/ponder-sh/ponder/issues",
                        });
                        throw new FlushError(error.message);
                      }),
                ),
              );
            }
          }

          if (updateValues.length > 0) {
            common.logger.debug({
              service: "indexing",
              msg: `Updating ${updateValues.length} cached '${tableNameCache.get(table)}' records in the database`,
            });

            const primaryKeys = primaryKeysCache.get(table)!;

            const set: { [column: string]: SQL } = {};
            for (const [columnName, column] of Object.entries(
              getTableColumns(table),
            )) {
              set[columnName] = sql.raw(
                `excluded."${getColumnCasing(column, "snake_case")}"`,
              );
            }

            for (
              let i = 0, len = updateValues.length;
              i < len;
              i += batchSize
            ) {
              promises.push(
                database.qb.user.wrap(
                  {
                    method: `${tableNameCache.get(table)}.flush()`,
                  },
                  async () =>
                    await database.drizzle
                      .insert(table)
                      .values(updateValues.slice(i, i + batchSize))
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
                      }),
                ),
              );
            }
          }
        }

        await Promise.all(promises);

        const flushIndex =
          totalCacheOps -
          cacheSize * (1 - common.options.indexingCacheFlushRatio);

        const shouldDelete = cacheBytes > maxBytes;

        for (const tableCache of cache.values()) {
          for (const [key, entry] of tableCache) {
            entry.type = EntryType.FIND;

            if (shouldDelete && entry.operationIndex < flushIndex) {
              tableCache.delete(key);
              cacheBytes -= entry.bytes;
              cacheSize -= 1;
            }
          }
        }

        if (shouldDelete) {
          isDatabaseEmpty = false;
        }
      });
    },
    isCacheFull() {
      return cacheBytes > maxBytes;
    },
    setPolicy(policy) {
      isHistoricalBackfill = policy === "historical";
    },
  } satisfies IndexingStore;

  // @ts-ignore
  return indexingStore;
};
