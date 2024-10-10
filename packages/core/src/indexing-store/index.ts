import {
  InvalidStoreMethodError,
  RecordNotFoundError,
} from "@/common/errors.js";
import type { Database } from "@/database/index.js";
import { type Schema, onchain } from "@/drizzle/index.js";
import { getPrimaryKeyColumns, getTableNames } from "@/drizzle/sql.js";
import type { Db } from "@/types/db.js";
import {
  type Column,
  type SQL,
  type Table,
  and,
  eq,
  getTableColumns,
  getTableName,
} from "drizzle-orm";
import { type PgTable, getTableConfig } from "drizzle-orm/pg-core";

export type IndexingStore = Db<Schema> & { flush: () => Promise<void> };

enum EntryType {
  INSERT = 0,
  UPDATE = 1,
  FIND = 2,
}

/** Cache entries that need to be created in the database. */
type InsertEntry = {
  type: EntryType.INSERT;
  bytes: number;
  row: { [key: string]: unknown };
};

/** Cache entries that need to be updated in the database. */
type UpdateEntry = {
  type: EntryType.UPDATE;
  bytes: number;
  row: { [key: string]: unknown };
};

/**
 * Cache entries that mirror the database. Can be `undefined`,
 * meaning the entry doesn't exist.
 */
export type FindEntry = {
  type: EntryType.FIND;
  bytes: number;
  row: { [key: string]: unknown } | undefined;
};

// TODO(kyle) key interning
type Key = string;
type Entry = InsertEntry | UpdateEntry | FindEntry;
type Cache = Map<string, Map<Key, Entry>>;

const getKeyConditional = (table: Table, key: Object): SQL<unknown> => {
  // @ts-ignore
  return and(
    // @ts-ignore
    ...Object.entries(key).map(([column, value]) => eq(table[column], value)),
  );
};

const checkOnchainTable = (
  table: Table,
  method: "find" | "insert" | "update" | "upsert" | "delete",
) => {
  if (onchain in table) return;

  throw new InvalidStoreMethodError(
    method === "find"
      ? `db.find() can only be used with onchain tables, and '${getTableConfig(table).name}' is an offchain table.`
      : `Indexing functions can only write to onchain tables, and '${getTableConfig(table).name}' is an offchain table.`,
  );
};

export const createIndexingStore = ({
  database,
  schema,
}: { database: Database; schema: Schema }): IndexingStore => {
  // TODO(kyle) all operations applied in a queue
  const wrap = database.qb.user.wrap;

  const primaryKeysCache: Map<string, string[]> = new Map();
  const cache: Cache = new Map();

  for (const { js, sql } of getTableNames(schema)) {
    primaryKeysCache.set(sql, getPrimaryKeyColumns(schema[js] as PgTable));
    cache.set(sql, new Map());
  }

  const getCacheKey = (
    table: Table,
    row: { [key: string]: unknown },
  ): string => {
    const primaryKeys = primaryKeysCache.get(getTableName(table))!;
    // TODO(kyle) is this resistant against different sql vs js names
    return (
      primaryKeys
        // @ts-ignore
        .map((pk) => normalizeColumn(table[pk], row[pk]))
        .join("_")
    );
  };

  const getCacheEntry = (table: Table, row: { [key: string]: unknown }) => {
    return cache.get(getTableName(table))!.get(getCacheKey(table, row));
  };

  const setCacheEntry = (
    table: Table,
    row: { [key: string]: unknown },
    entry: Entry,
  ) => {
    cache.get(getTableName(table))!.set(getCacheKey(table, row), entry);
  };

  const deleteCacheEntry = (table: Table, row: { [key: string]: unknown }) => {
    return cache.get(getTableName(table))!.delete(getCacheKey(table, row));
  };

  const normalizeRow = (table: Table, row: { [key: string]: unknown }) => {
    for (const [columnName, column] of Object.entries(getTableColumns(table))) {
      // TODO(kyle) throw error if column missing
      row[columnName] = normalizeColumn(column, row[columnName]);
    }

    return row;
  };

  const normalizeColumn = (column: Column, value: unknown) => {
    if (column.mapToDriverValue === undefined) return value;
    return column.mapFromDriverValue(column.mapToDriverValue(value));
  };

  const getRowBytes = (
    _table: Table,
    row: { [key: string]: unknown } | undefined,
  ) => {
    if (row === undefined) return 32;
    // TODO(kyle) memoize size
    return 512;
  };

  const handleUserInput = (
    table: Table,
    userRow: { [key: string]: unknown },
    existingRow?: { [key: string]: unknown },
  ) => {
    let row = structuredClone(userRow);

    if (existingRow) {
      for (const [key, value] of Object.entries(row)) {
        existingRow[key] = value;
      }
      existingRow = normalizeRow(table, existingRow);
      const bytes = getRowBytes(table, existingRow);
      return { bytes, row: existingRow };
    }

    row = normalizeRow(table, row);
    const bytes = getRowBytes(table, row);
    return { bytes, row };
  };

  const isDatabaseEmpty = true;

  // TODO(kyle) should find return null or undefined
  const find = (table: Table, key: object) => {
    return database.drizzle
      .select()
      .from(table as PgTable)
      .where(getKeyConditional(table as PgTable, key))
      .then((res) => (res.length === 0 ? undefined : res[0]));
  };

  // @ts-ignore
  const indexingStore = {
    // @ts-ignore
    find: (table: Table, key) =>
      // @ts-ignore
      wrap({ method: `${getTableConfig(table).name}.find()` }, async () => {
        checkOnchainTable(table as Table, "find");

        const entry = getCacheEntry(table, key);

        if (entry) {
          // update lru ordering
          deleteCacheEntry(table, key);
          setCacheEntry(table, key, entry);

          return entry.row;
        } else {
          if (isDatabaseEmpty) return undefined;

          const row = await find(table, key);
          const size = getRowBytes(table, row);

          setCacheEntry(table, key, {
            type: EntryType.FIND,
            row,
            bytes: size,
          });

          return find(table, key);
        }
      }),
    // @ts-ignore
    insert(table: Table) {
      return {
        values: (values: any) =>
          wrap(
            { method: `${getTableConfig(table as PgTable).name}.insert()` },
            async () => {
              checkOnchainTable(table as Table, "insert");
              if (Array.isArray(values)) {
                for (const value of values) {
                  const key = getCacheKey(table, value);

                  // TODO(kyle) check if present, error

                  setCacheEntry(table, value, {
                    type: EntryType.INSERT,
                    ...handleUserInput(table, value),
                  });

                  // update cache metadata
                }
              } else {
                const key = getCacheKey(table, values);

                // TODO(kyle) check if present, error

                setCacheEntry(table, values, {
                  type: EntryType.INSERT,
                  ...handleUserInput(table, values),
                });

                // update cache metadata
              }
            },
          ),
      };
    },
    // @ts-ignore
    update(table: Table, key) {
      return {
        set: (values: any) =>
          wrap(
            { method: `${getTableConfig(table as PgTable).name}.update()` },
            async () => {
              checkOnchainTable(table as Table, "update");

              const entry = getCacheEntry(table, key);
              deleteCacheEntry(table, key);

              let row: { [key: string]: unknown };

              if (entry?.row) {
                row = entry.row;
              } else {
                if (isDatabaseEmpty) {
                  throw new RecordNotFoundError(
                    "No existing record was found with the specified ID",
                  );
                }

                const findResult = await find(table, key);

                if (findResult) {
                  row = findResult;
                } else {
                  throw new RecordNotFoundError(
                    "No existing record was found with the specified ID",
                  );
                }
              }

              if (typeof values === "function") {
                setCacheEntry(table, key, {
                  type:
                    entry?.type === EntryType.INSERT
                      ? EntryType.INSERT
                      : EntryType.UPDATE,
                  ...handleUserInput(table, values(row), row),
                });
              } else {
                setCacheEntry(table, key, {
                  type:
                    entry?.type === EntryType.INSERT
                      ? EntryType.INSERT
                      : EntryType.UPDATE,
                  ...handleUserInput(table, values, row),
                });
              }
            },
          ),
      };
    },
    // @ts-ignore
    upsert(table: Table, key) {
      return {
        insert(valuesI: any) {
          return {
            update: (valuesU: any) =>
              wrap(
                { method: `${getTableConfig(table as PgTable).name}.upsert()` },
                async () => {
                  checkOnchainTable(table as Table, "upsert");

                  const entry = getCacheEntry(table, key);
                  deleteCacheEntry(table, key);

                  let row: { [key: string]: unknown } | undefined;

                  if (entry?.row) {
                    row = entry.row;
                  } else {
                    if (isDatabaseEmpty) row = undefined;
                    else row = await find(table, key);
                  }

                  if (row === undefined) {
                    setCacheEntry(table, key, {
                      type: EntryType.INSERT,
                      ...handleUserInput(table, valuesI, key),
                    });
                  } else {
                    if (typeof valuesU === "function") {
                      setCacheEntry(table, key, {
                        type:
                          entry?.type === EntryType.INSERT
                            ? EntryType.INSERT
                            : EntryType.UPDATE,
                        ...handleUserInput(table, valuesU(row), row),
                      });
                    } else {
                      setCacheEntry(table, key, {
                        type:
                          entry?.type === EntryType.INSERT
                            ? EntryType.INSERT
                            : EntryType.UPDATE,
                        ...handleUserInput(table, valuesU, row),
                      });
                    }
                  }
                },
              ),
            // biome-ignore lint/suspicious/noThenProperty: <explanation>
            then: () =>
              wrap(
                { method: `${getTableConfig(table as PgTable).name}.upsert()` },
                async () => {
                  checkOnchainTable(table as Table, "upsert");

                  const entry = getCacheEntry(table, key);

                  let row: { [key: string]: unknown } | undefined;

                  if (entry?.row) {
                    row = entry.row;
                  } else {
                    if (isDatabaseEmpty) row = undefined;
                    else row = await find(table, key);
                  }

                  if (row === undefined) {
                    setCacheEntry(table, key, {
                      type: EntryType.INSERT,
                      ...handleUserInput(table, valuesI, key),
                    });
                  }
                },
              ),
          };
        },
        update(valuesU: any) {
          return {
            insert: (valuesI: any) =>
              indexingStore.upsert(table, key).insert(valuesI).update(valuesU),
            // biome-ignore lint/suspicious/noThenProperty: <explanation>
            then: () =>
              wrap(
                { method: `${getTableConfig(table as PgTable).name}.upsert()` },
                async () => {
                  checkOnchainTable(table as Table, "upsert");

                  const entry = getCacheEntry(table, key);
                  deleteCacheEntry(table, key);

                  let row: { [key: string]: unknown } | undefined;

                  if (entry?.row) {
                    row = entry.row;
                  } else {
                    if (isDatabaseEmpty) row = undefined;
                    else row = await find(table, key);
                  }

                  if (row) {
                    if (typeof valuesU === "function") {
                      setCacheEntry(table, key, {
                        type:
                          entry?.type === EntryType.INSERT
                            ? EntryType.INSERT
                            : EntryType.UPDATE,
                        ...handleUserInput(table, valuesU(row), row),
                      });
                    } else {
                      setCacheEntry(table, key, {
                        type:
                          entry?.type === EntryType.INSERT
                            ? EntryType.INSERT
                            : EntryType.UPDATE,
                        ...handleUserInput(table, valuesU, row),
                      });
                    }
                  }
                },
              ),
          };
        },
      };
    },
    // @ts-ignore
    delete: (table: Table, key) =>
      wrap(
        { method: `${getTableConfig(table as PgTable).name}.delete()` },
        async () => {
          checkOnchainTable(table as Table, "upsert");

          const entry = getCacheEntry(table, key);
          deleteCacheEntry(table, key);

          if (entry?.row) {
            if (entry.type === EntryType.INSERT) {
              return true;
            }

            await database.drizzle
              .delete(table as Table)
              .where(getKeyConditional(table as Table, key));

            return true;
          } else {
            if (isDatabaseEmpty) {
              return false;
            }

            const deleteResult = await database.drizzle
              .delete(table as Table)
              .where(getKeyConditional(table as Table, key))
              .returning();

            return deleteResult.length > 0;
          }
        },
      ),
    sql: database.drizzle,
    async flush() {},
  } satisfies IndexingStore;

  // @ts-ignore
  return indexingStore;
};
