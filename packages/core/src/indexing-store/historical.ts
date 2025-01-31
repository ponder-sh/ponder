import type { Database } from "@/database/index.js";
import type { Common } from "@/internal/common.js";
import {
  RecordNotFoundError,
  UniqueConstraintError,
} from "@/internal/errors.js";
import type { SchemaBuild } from "@/internal/types.js";
import { prettyPrint } from "@/utils/print.js";
import { createQueue } from "@ponder/common";
import { type QueryWithTypings, type Table, getTableName } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pg-proxy";
import { EntryType, type IndexingCache } from "./cache.js";
import {
  type IndexingStore,
  checkOnchainTable,
  parseSqlError,
} from "./index.js";

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

  return {
    // @ts-ignore
    find: (table: Table, key) =>
      queue.add(() =>
        database.wrap(
          { method: `${getTableName(table) ?? "unknown"}.find()` },
          async () => {
            checkOnchainTable(table, "find");
            return indexingCache.get(table, key);
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
                        const row = await indexingCache.get(table, value);

                        if (row) {
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
                      return rows;
                    } else {
                      const row = await indexingCache.get(table, values);

                      if (row) {
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
                        const row = await indexingCache.get(table, value);

                        if (row) {
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
                          rows.push(
                            indexingCache.set(
                              table,
                              value,
                              value,
                              EntryType.UPDATE,
                            ),
                          );
                        }
                      }
                      return rows;
                    } else {
                      const row = await indexingCache.get(table, values);

                      if (row) {
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
                          const row = await indexingCache.get(table, value);

                          if (row) {
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
                        const row = await indexingCache.get(table, values);

                        // TODO(kyle) optimistically assume no conflict,
                        // check for error at flush time
                        if (row) {
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

                const row = await indexingCache.get(table, values);

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
            return indexingCache.delete(table, key);
          },
        ),
      ),
    // @ts-ignore
    sql: drizzle(
      async (_sql, params, method, typings) => {
        await indexingCache.flush();
        indexingCache.bust();

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
