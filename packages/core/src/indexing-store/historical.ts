import type { Common } from "@/common/common.js";
import {
  BigIntSerializationError,
  FlushError,
  InvalidStoreMethodError,
  NotNullConstraintError,
  RecordNotFoundError,
  UndefinedTableError,
  UniqueConstraintError,
} from "@/common/errors.js";
import type { Database } from "@/database/index.js";
import {
  type Schema,
  getPrimaryKeyColumns,
  getTableNames,
  onchain,
} from "@/drizzle/index.js";
import { getColumnCasing } from "@/drizzle/kit/index.js";
import { encodeCheckpoint, zeroCheckpoint } from "@/utils/checkpoint.js";
import { prettyPrint } from "@/utils/print.js";
import { createQueue } from "@ponder/common";
import {
  type Column,
  type QueryWithTypings,
  type SQL,
  type SQLWrapper,
  type Table,
  and,
  eq,
  getTableColumns,
  sql,
} from "drizzle-orm";
import { type PgTable, getTableConfig } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pg-proxy";
import { type IndexingStore, parseSqlError } from "./index.js";

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
type FindEntry = {
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
const empty = null;

/** Throw an error if `table` is not an `onchainTable`. */
const checkOnchainTable = (
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

/**
 * Returns true if the column has a "default" value that is used when no value is passed.
 * Handles `.default`, `.$defaultFn()`, `.$onUpdateFn()`.
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

export const createHistoricalIndexingStore = ({
  common,
  database,
  schema,
  initialCheckpoint,
}: {
  common: Common;
  database: Database;
  schema: Schema;
  initialCheckpoint: string;
}): IndexingStore<"historical"> => {
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
  const cache: Cache = new Map();

  for (const tableName of getTableNames(schema, "")) {
    primaryKeysCache.set(
      schema[tableName.js] as Table,
      getPrimaryKeyColumns(schema[tableName.js] as PgTable),
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
    }
    return cache.get(table)!.delete(getCacheKey(table, row));
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

  let isDatabaseEmpty = initialCheckpoint === encodeCheckpoint(zeroCheckpoint);
  /** Estimated number of bytes used by cache. */
  let cacheBytes = 0;
  /** LRU counter. */
  let totalCacheOps = 0;

  const maxBytes = common.options.indexingCacheMaxBytes;
  common.logger.debug({
    service: "indexing",
    msg: `Using a ${Math.round(maxBytes / (1024 * 1024))} MB indexing cache`,
  });

  /** Returns an sql where condition for `table` with `key`. */
  const getWhereCondition = (table: Table, key: Object): SQL<unknown> => {
    primaryKeysCache.get(table)!;

    const conditions: SQLWrapper[] = [];

    for (const { js } of primaryKeysCache.get(table)!) {
      // @ts-ignore
      conditions.push(eq(table[js]!, key[js]));
    }

    return and(...conditions)!;
  };

  const find = (table: Table, key: object) => {
    return database.drizzle
      .select()
      .from(table)
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
            checkOnchainTable(table, "find");

            const entry = getCacheEntry(table, key);

            if (entry) {
              // update lru ordering
              getCacheEntry(table, key)!.operationIndex = totalCacheOps++;

              return entry.row;
            } else {
              if (isDatabaseEmpty) return null;

              const row = await find(table, key);
              const bytes = getBytes(row);

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
        values: (values: any) => {
          // @ts-ignore
          const inner = {
            onConflictDoNothing: () =>
              queue.add(() =>
                database.qb.user.wrap(
                  {
                    method: `${tableNameCache.get(table) ?? "unknown"}.insert()`,
                  },
                  async () => {
                    checkOnchainTable(table, "insert");

                    if (Array.isArray(values)) {
                      const rows = [];
                      for (const value of values) {
                        const entry = getCacheEntry(table, value);

                        let row: { [key: string]: unknown } | null;

                        if (entry?.row) {
                          row = entry.row;
                        } else {
                          if (isDatabaseEmpty) row = null;
                          else row = await find(table, value);
                        }

                        if (row === null) {
                          rows.push(
                            setCacheEntry(table, value, EntryType.INSERT),
                          );
                        } else {
                          rows.push(null);
                        }
                      }
                      return rows;
                    } else {
                      const entry = getCacheEntry(table, values);

                      let row: { [key: string]: unknown } | null;

                      if (entry?.row) {
                        row = entry.row;
                      } else {
                        if (isDatabaseEmpty) row = null;
                        else row = await find(table, values);
                      }

                      if (row === null) {
                        return setCacheEntry(table, values, EntryType.INSERT);
                      }

                      return null;
                    }
                  },
                ),
              ),
            onConflictDoUpdate: (valuesU: any) =>
              queue.add(() =>
                database.qb.user.wrap(
                  {
                    method: `${tableNameCache.get(table) ?? "unknown"}.insert()`,
                  },
                  async () => {
                    checkOnchainTable(table, "insert");

                    if (Array.isArray(values)) {
                      const rows = [];
                      for (const value of values) {
                        const entry = getCacheEntry(table, value);
                        deleteCacheEntry(table, value);

                        let row: { [key: string]: unknown } | typeof empty;

                        if (entry?.row) {
                          row = entry.row;
                        } else {
                          if (isDatabaseEmpty) row = null;
                          else row = await find(table, value);
                        }

                        if (row === null) {
                          rows.push(
                            setCacheEntry(table, value, EntryType.INSERT),
                          );
                        } else {
                          if (typeof valuesU === "function") {
                            rows.push(
                              setCacheEntry(
                                table,
                                valuesU(row),
                                entry?.type === EntryType.INSERT
                                  ? EntryType.INSERT
                                  : EntryType.UPDATE,
                                row,
                              ),
                            );
                          } else {
                            rows.push(
                              setCacheEntry(
                                table,
                                valuesU,
                                entry?.type === EntryType.INSERT
                                  ? EntryType.INSERT
                                  : EntryType.UPDATE,
                                row,
                              ),
                            );
                          }
                        }
                      }
                      return rows;
                    } else {
                      const entry = getCacheEntry(table, values);
                      deleteCacheEntry(table, values);

                      let row: { [key: string]: unknown } | typeof empty;

                      if (entry?.row) {
                        row = entry.row;
                      } else {
                        if (isDatabaseEmpty) row = null;
                        else row = await find(table, values);
                      }

                      if (row === null) {
                        return setCacheEntry(table, values, EntryType.INSERT);
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
                    }
                  },
                ),
              ),
            // biome-ignore lint/suspicious/noThenProperty: <explanation>
            then: (onFulfilled, onRejected) =>
              queue
                .add(() =>
                  database.qb.user.wrap(
                    {
                      method: `${tableNameCache.get(table) ?? "unknown"}.insert()`,
                    },
                    async () => {
                      checkOnchainTable(table, "insert");

                      if (Array.isArray(values)) {
                        const rows = [];
                        for (const value of values) {
                          if (getCacheEntry(table, value)?.row) {
                            const error = new UniqueConstraintError(
                              `Unique constraint failed for '${tableNameCache.get(table)}'.`,
                            );
                            error.meta.push(
                              `db.insert arguments:\n${prettyPrint(value)}`,
                            );
                            throw error;
                          } else if (isDatabaseEmpty === false) {
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

                          rows.push(
                            setCacheEntry(table, value, EntryType.INSERT),
                          );
                        }
                        return rows;
                      } else {
                        if (getCacheEntry(table, values)?.row) {
                          const error = new UniqueConstraintError(
                            `Unique constraint failed for '${tableNameCache.get(table)}'.`,
                          );
                          error.meta.push(
                            `db.insert arguments:\n${prettyPrint(values)}`,
                          );
                          throw error;
                        } else if (isDatabaseEmpty === false) {
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
                )
                .then(onFulfilled, onRejected),
            catch: (onRejected) => inner.then(undefined, onRejected),
            finally: (onFinally) =>
              inner.then(
                (value: any) => {
                  onFinally?.();
                  return value;
                },
                (reason: any) => {
                  onFinally?.();
                  throw reason;
                },
              ),
            // @ts-ignore
          } satisfies ReturnType<
            ReturnType<IndexingStore<"historical">["insert"]>["values"]
          >;

          return inner;
        },
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
                checkOnchainTable(table, "update");

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
                      `db.update arguments:\n${prettyPrint(key)}`,
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
                      `db.update arguments:\n${prettyPrint(key)}`,
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
    delete: (table: Table, key) =>
      queue.add(() =>
        database.qb.user.wrap(
          { method: `${tableNameCache.get(table) ?? "unknown"}.delete()` },
          async () => {
            checkOnchainTable(table, "delete");

            const entry = getCacheEntry(table, key);
            deleteCacheEntry(table, key);

            if (entry?.row) {
              if (entry.type === EntryType.INSERT) {
                return true;
              }

              await database.drizzle
                .delete(table)
                .where(getWhereCondition(table, key));

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
        await database.createTriggers();
        await indexingStore.flush();
        await database.removeTriggers();

        const query: QueryWithTypings = { sql: _sql, params, typings };

        const res = await database.qb.user.wrap({ method: "sql" }, async () => {
          try {
            return await database.drizzle._.session
              .prepareQuery(query, undefined, undefined, method === "all")
              .execute();
          } catch (e) {
            throw parseSqlError(e);
          }
        });

        // @ts-ignore
        return { rows: res.rows.map((row) => Object.values(row)) };
      },
      { schema, casing: "snake_case" },
    ),
    async flush() {
      await queue.add(async () => {
        let cacheSize = 0;
        for (const c of cache.values()) cacheSize += c.size;

        const flushIndex =
          totalCacheOps -
          cacheSize * (1 - common.options.indexingCacheFlushRatio);
        const shouldDelete = cacheBytes > maxBytes;
        if (shouldDelete) isDatabaseEmpty = false;

        const promises: Promise<void>[] = [];

        for (const [table, tableCache] of cache) {
          const batchSize = Math.round(
            common.options.databaseMaxQueryParameters /
              Object.keys(getTableColumns(table)).length,
          );

          const insertValues: InsertEntry["row"][] = [];
          const updateValues: UpdateEntry["row"][] = [];

          for (const [key, entry] of tableCache) {
            if (entry.type === EntryType.INSERT) {
              insertValues.push(entry.row);
            }

            if (entry.type === EntryType.UPDATE) {
              updateValues.push(entry.row);
            }

            if (shouldDelete && entry.operationIndex < flushIndex) {
              tableCache.delete(key);
              cacheBytes -= entry.bytes;
            }

            entry.type = EntryType.FIND;
          }

          if (insertValues.length > 0) {
            common.logger.debug({
              service: "indexing",
              msg: `Inserting ${insertValues.length} cached '${tableNameCache.get(table)}' rows into the database`,
            });

            while (insertValues.length > 0) {
              const values = insertValues.splice(0, batchSize);
              promises.push(
                database.qb.user.wrap(
                  { method: `${tableNameCache.get(table)}.flush()` },
                  async () => {
                    await database.drizzle
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
              msg: `Updating ${updateValues.length} cached '${tableNameCache.get(table)}' rows in the database`,
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

            while (updateValues.length > 0) {
              const values = updateValues.splice(0, batchSize);
              promises.push(
                database.qb.user.wrap(
                  {
                    method: `${tableNameCache.get(table)}.flush()`,
                  },
                  async () => {
                    await database.drizzle
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
      });
    },
    isCacheFull() {
      return cacheBytes > maxBytes;
    },
  } satisfies IndexingStore<"historical">;

  // @ts-ignore
  return indexingStore;
};
