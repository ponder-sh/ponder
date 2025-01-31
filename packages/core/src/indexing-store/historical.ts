import type { Database } from "@/database/index.js";
import { getPrimaryKeyColumns } from "@/drizzle/index.js";
import type { Common } from "@/internal/common.js";
import {
  RecordNotFoundError,
  UniqueConstraintError,
} from "@/internal/errors.js";
import type { SchemaBuild } from "@/internal/types.js";
import { prettyPrint } from "@/utils/print.js";
import { createQueue } from "@ponder/common";
import {
  type QueryWithTypings,
  type SQL,
  type SQLWrapper,
  type Table,
  and,
  eq,
  getTableName,
} from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pg-proxy";
import { EntryType, type IndexingCache } from "./cache.js";
import {
  type IndexingStore,
  checkOnchainTable,
  parseSqlError,
} from "./index.js";

/** Returns an sql where condition for `table` with `key`. */
const getWhereCondition = (table: Table, key: Object): SQL<unknown> => {
  const conditions: SQLWrapper[] = [];

  for (const { js } of getPrimaryKeyColumns(table)) {
    // @ts-ignore
    conditions.push(eq(table[js]!, key[js]));
  }

  return and(...conditions)!;
};

export const createHistoricalIndexingStore = ({
  database,
  schemaBuild: { schema },
  indexingCache,
}: {
  common: Common;
  database: Database;
  schemaBuild: Pick<SchemaBuild, "schema">;
  indexingCache: IndexingCache;
}): IndexingStore => {
  // Operation queue to make sure all queries are run in order, circumventing race conditions
  const queue = createQueue<unknown, () => Promise<unknown>>({
    browser: false,
    initialStart: true,
    concurrency: 1,
    worker: (fn) => fn(),
  });

  const find = (table: Table, key: object) =>
    database.wrap(
      { method: `${getTableName(table) ?? "unknown"}.cache.find()` },
      async () => {
        return database.qb.drizzle
          .select()
          .from(table)
          .where(getWhereCondition(table as PgTable, key))
          .then((res) => (res.length === 0 ? null : res[0]!));
      },
    );

  return {
    // @ts-ignore
    find: (table: Table, key) =>
      queue.add(() =>
        database.wrap(
          { method: `${getTableName(table) ?? "unknown"}.find()` },
          async () => {
            checkOnchainTable(table, "find");

            if (indexingCache.has(table, key)) {
              return indexingCache.get(table, key);
            }

            const row = await find(table, key);
            return indexingCache.set(table, key, row, EntryType.FIND);
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
                database.wrap(
                  {
                    method: `${getTableName(table) ?? "unknown"}.insert()`,
                  },
                  async () => {
                    checkOnchainTable(table, "insert");

                    if (Array.isArray(values)) {
                      const rows = [];
                      for (const value of values) {
                        if (
                          indexingCache.has(table, value) &&
                          indexingCache.get(table, value)
                        ) {
                          rows.push(null);
                        } else {
                          const findResult = await find(table, value);

                          if (findResult) {
                            indexingCache.set(
                              table,
                              value,
                              findResult,
                              EntryType.INSERT,
                            );
                            rows.push(null);
                          } else {
                            rows.push(
                              indexingCache.set(
                                table,
                                value,
                                value,
                                EntryType.INSERT,
                              ),
                            );
                          }
                        }
                      }
                      return rows;
                    } else {
                      if (
                        indexingCache.has(table, values) &&
                        indexingCache.get(table, values)
                      ) {
                        return null;
                      }

                      const findResult = await find(table, values);

                      if (findResult) {
                        indexingCache.set(
                          table,
                          values,
                          findResult,
                          EntryType.INSERT,
                        );
                        return null;
                      }

                      return indexingCache.set(
                        table,
                        values,
                        values,
                        EntryType.INSERT,
                      );
                    }
                  },
                ),
              ),
            onConflictDoUpdate: (valuesU: any) =>
              queue.add(() =>
                database.wrap(
                  {
                    method: `${getTableName(table) ?? "unknown"}.insert()`,
                  },
                  async () => {
                    checkOnchainTable(table, "insert");

                    if (Array.isArray(values)) {
                      const rows = [];
                      for (const value of values) {
                        if (
                          indexingCache.has(table, value) &&
                          indexingCache.get(table, value)
                        ) {
                          const row = indexingCache.get(table, value)!;
                          if (typeof valuesU === "function") {
                            for (const [key, value] of Object.entries(
                              valuesU(row),
                            )) {
                              row[key] = value;
                            }
                          } else {
                            for (const [key, value] of Object.entries(
                              valuesU,
                            )) {
                              row[key] = value;
                            }
                          }
                          rows.push(
                            indexingCache.set(
                              table,
                              row,
                              row,
                              EntryType.UPDATE,
                            ),
                          );
                        } else {
                          const findResult = await find(table, values);

                          if (findResult) {
                            if (typeof valuesU === "function") {
                              for (const [key, value] of Object.entries(
                                valuesU(findResult),
                              )) {
                                findResult[key] = value;
                              }
                            } else {
                              for (const [key, value] of Object.entries(
                                valuesU,
                              )) {
                                findResult[key] = value;
                              }
                            }
                            rows.push(
                              indexingCache.set(
                                table,
                                values,
                                findResult,
                                EntryType.UPDATE,
                              ),
                            );
                          } else {
                            rows.push(
                              indexingCache.set(
                                table,
                                values,
                                findResult,
                                EntryType.INSERT,
                              ),
                            );
                          }
                        }
                      }
                      return rows;
                    } else {
                      if (
                        indexingCache.has(table, values) &&
                        indexingCache.get(table, values)
                      ) {
                        const row = indexingCache.get(table, values)!;
                        if (typeof valuesU === "function") {
                          for (const [key, value] of Object.entries(
                            valuesU(row),
                          )) {
                            row[key] = value;
                          }
                        } else {
                          for (const [key, value] of Object.entries(valuesU)) {
                            row[key] = value;
                          }
                        }
                        return indexingCache.set(
                          table,
                          values,
                          row,
                          EntryType.UPDATE,
                        );
                      }
                      const findResult = await find(table, values);

                      if (findResult) {
                        if (typeof valuesU === "function") {
                          for (const [key, value] of Object.entries(
                            valuesU(findResult),
                          )) {
                            findResult[key] = value;
                          }
                        } else {
                          for (const [key, value] of Object.entries(valuesU)) {
                            findResult[key] = value;
                          }
                        }
                        return indexingCache.set(
                          table,
                          values,
                          findResult,
                          EntryType.UPDATE,
                        );
                      }

                      return indexingCache.set(
                        table,
                        values,
                        values,
                        EntryType.INSERT,
                      );
                    }
                  },
                ),
              ),
            // biome-ignore lint/suspicious/noThenProperty: <explanation>
            then: (onFulfilled, onRejected) =>
              queue
                .add(() =>
                  database.wrap(
                    {
                      method: `${getTableName(table) ?? "unknown"}.insert()`,
                    },
                    async () => {
                      checkOnchainTable(table, "insert");

                      if (Array.isArray(values)) {
                        const rows = [];
                        for (const value of values) {
                          if (
                            indexingCache.has(table, value) &&
                            indexingCache.get(table, value)
                          ) {
                            const error = new UniqueConstraintError(
                              `Unique constraint failed for '${getTableName(table)}'.`,
                            );
                            error.meta.push(
                              `db.insert arguments:\n${prettyPrint(value)}`,
                            );
                            throw error;
                          }

                          const findResult = await find(table, value);

                          if (findResult) {
                            const error = new UniqueConstraintError(
                              `Unique constraint failed for '${getTableName(table)}'.`,
                            );
                            error.meta.push(
                              `db.insert arguments:\n${prettyPrint(value)}`,
                            );
                            throw error;
                          }

                          rows.push(
                            indexingCache.set(
                              table,
                              value,
                              value,
                              EntryType.INSERT,
                            ),
                          );
                        }
                        return rows;
                      } else {
                        if (
                          indexingCache.has(table, values) &&
                          indexingCache.get(table, values)
                        ) {
                          const error = new UniqueConstraintError(
                            `Unique constraint failed for '${getTableName(table)}'.`,
                          );
                          error.meta.push(
                            `db.insert arguments:\n${prettyPrint(values)}`,
                          );
                          throw error;
                        }

                        // TODO(kyle) optimistically assume no conflict,
                        // check for error at flush time
                        const findResult = await find(table, values);

                        if (findResult) {
                          const error = new UniqueConstraintError(
                            `Unique constraint failed for '${getTableName(table)}'.`,
                          );
                          error.meta.push(
                            `db.insert arguments:\n${prettyPrint(values)}`,
                          );
                          throw error;
                        }

                        return indexingCache.set(
                          table,
                          values,
                          values,
                          EntryType.INSERT,
                        );
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
          } satisfies ReturnType<ReturnType<IndexingStore["insert"]>["values"]>;

          return inner;
        },
      };
    },
    // @ts-ignore
    update(table: Table, key) {
      return {
        set: (values: any) =>
          queue.add(() =>
            database.wrap(
              { method: `${getTableName(table) ?? "unknown"}.update()` },
              async () => {
                checkOnchainTable(table, "update");

                let row: { [key: string]: unknown } | null;

                if (indexingCache.has(table, key)) {
                  row = indexingCache.get(table, key);
                } else {
                  row = await find(table, key);
                }

                if (row === null) {
                  const error = new RecordNotFoundError(
                    `No existing record found in table '${getTableName(table)}'`,
                  );
                  error.meta.push(`db.update arguments:\n${prettyPrint(key)}`);
                  throw error;
                }

                if (typeof values === "function") {
                  for (const [key, value] of Object.entries(values(row))) {
                    row[key] = value;
                  }
                } else {
                  for (const [key, value] of Object.entries(values)) {
                    row[key] = value;
                  }
                }

                return indexingCache.set(table, key, row, EntryType.UPDATE);
              },
            ),
          ),
      };
    },
    // @ts-ignore
    delete: (table: Table, key) =>
      queue.add(() =>
        database.wrap(
          { method: `${getTableName(table) ?? "unknown"}.delete()` },
          async () => {
            checkOnchainTable(table, "delete");

            // in the cache with null
            // in the cache with a value
            // not in the cache

            if (
              indexingCache.has(table, key) &&
              indexingCache.get(table, key) === null
            ) {
              return false;
            }

            if (indexingCache.has(table, key)) {
              // TODO(kyle) if cache is not complete, delete from db
              // await database.qb.drizzle
              //   .delete(table)
              //   .where(getWhereCondition(table, key));
              // }

              return true;
            }

            const deleteResult = await database.qb.drizzle
              .delete(table)
              .where(getWhereCondition(table, key))
              .returning();

            return deleteResult.length > 0;
          },
        ),
      ),
    // @ts-ignore
    sql: drizzle(
      async (_sql, params, method, typings) => {
        await indexingCache.flush();
        // TODO(kyle) invalidate cache

        const query: QueryWithTypings = { sql: _sql, params, typings };

        const res = await database.wrap({ method: "sql" }, async () => {
          try {
            return await database.qb.drizzle._.session
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
    queue,
  };
};
