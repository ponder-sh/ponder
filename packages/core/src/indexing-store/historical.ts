import { findTableNames, validateQuery } from "@/client/parse.js";
import type { Common } from "@/internal/common.js";
import {
  InvalidStoreMethodError,
  RecordNotFoundError,
} from "@/internal/errors.js";
import type { Schema, SchemaBuild } from "@/internal/types.js";
import type { Drizzle } from "@/types/db.js";
import { prettyPrint } from "@/utils/print.js";
import { startClock } from "@/utils/timer.js";
import type { PGlite } from "@electric-sql/pglite";
import { type QueryWithTypings, type Table, getTableName } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pg-proxy";
import type { PoolClient } from "pg";
import type { IndexingCache } from "./cache.js";
import {
  type IndexingStore,
  checkOnchainTable,
  checkTableAccess,
  parseSqlError,
  validateUpdateSet,
} from "./index.js";

export const createHistoricalIndexingStore = ({
  common,
  schemaBuild: { schema },
  indexingCache,
  db,
  client,
  chainId,
}: {
  common: Common;
  schemaBuild: Pick<SchemaBuild, "schema">;
  indexingCache: IndexingCache;
  db: Drizzle<Schema>;
  client: PoolClient | PGlite;
  chainId?: number;
}): IndexingStore => {
  return {
    // @ts-ignore
    find: (table: Table, key) => {
      common.metrics.ponder_indexing_store_queries_total.inc({
        table: getTableName(table),
        method: "find",
      });
      checkOnchainTable(table, "find");
      checkTableAccess(table, "find", key, chainId);
      return indexingCache.get({ table, key, db });
    },

    // @ts-ignore
    insert(table: Table) {
      return {
        values: (values: any) => {
          // @ts-ignore
          const inner = {
            onConflictDoNothing: async () => {
              common.metrics.ponder_indexing_store_queries_total.inc({
                table: getTableName(table),
                method: "insert",
              });
              checkOnchainTable(table, "insert");

              if (Array.isArray(values)) {
                const rows = [];
                for (const value of values) {
                  checkTableAccess(table, "insert", value, chainId);
                  const row = await indexingCache.get({
                    table,
                    key: value,
                    db,
                  });

                  if (row) {
                    rows.push(null);
                  } else {
                    rows.push(
                      indexingCache.set({
                        table,
                        key: value,
                        row: value,
                        isUpdate: false,
                      }),
                    );
                  }
                }
                return rows;
              } else {
                checkTableAccess(table, "insert", values, chainId);
                const row = await indexingCache.get({
                  table,
                  key: values,
                  db,
                });

                if (row) {
                  return null;
                }

                return indexingCache.set({
                  table,
                  key: values,
                  row: values,
                  isUpdate: false,
                });
              }
            },
            onConflictDoUpdate: async (valuesU: any) => {
              common.metrics.ponder_indexing_store_queries_total.inc({
                table: getTableName(table),
                method: "insert",
              });
              checkOnchainTable(table, "insert");

              if (Array.isArray(values)) {
                const rows = [];
                for (const value of values) {
                  const row = await indexingCache.get({
                    table,
                    key: value,
                    db,
                  });

                  if (row) {
                    if (typeof valuesU === "function") {
                      const set = validateUpdateSet(table, valuesU(row), row);
                      for (const [key, value] of Object.entries(set)) {
                        if (value === undefined) continue;
                        row[key] = value;
                      }
                    } else {
                      const set = validateUpdateSet(table, valuesU, row);
                      for (const [key, value] of Object.entries(set)) {
                        if (value === undefined) continue;
                        row[key] = value;
                      }
                    }
                    checkTableAccess(table, "insert", row, chainId);
                    rows.push(
                      indexingCache.set({
                        table,
                        key: value,
                        row,
                        isUpdate: true,
                      }),
                    );
                  } else {
                    checkTableAccess(table, "insert", value, chainId);
                    rows.push(
                      indexingCache.set({
                        table,
                        key: value,
                        row: value,
                        isUpdate: false,
                      }),
                    );
                  }
                }
                return rows;
              } else {
                checkTableAccess(table, "insert", values, chainId);
                const row = await indexingCache.get({ table, key: values, db });

                if (row) {
                  if (typeof valuesU === "function") {
                    const set = validateUpdateSet(table, valuesU(row), row);
                    for (const [key, value] of Object.entries(set)) {
                      if (value === undefined) continue;
                      row[key] = value;
                    }
                  } else {
                    const set = validateUpdateSet(table, valuesU, row);
                    for (const [key, value] of Object.entries(set)) {
                      if (value === undefined) continue;
                      row[key] = value;
                    }
                  }
                  checkTableAccess(table, "insert", row, chainId);
                  return indexingCache.set({
                    table,
                    key: values,
                    row,
                    isUpdate: true,
                  });
                }

                return indexingCache.set({
                  table,
                  key: values,
                  row: values,
                  isUpdate: false,
                });
              }
            },
            // biome-ignore lint/suspicious/noThenProperty: <explanation>
            then: (onFulfilled, onRejected) => {
              common.metrics.ponder_indexing_store_queries_total.inc({
                table: getTableName(table),
                method: "insert",
              });
              checkOnchainTable(table, "insert");

              if (Array.isArray(values)) {
                const rows = [];
                for (const value of values) {
                  // Note: optimistic assumption that no conflict exists
                  // because error is recovered at flush time
                  checkTableAccess(table, "insert", value, chainId);
                  rows.push(
                    indexingCache.set({
                      table,
                      key: value,
                      row: value,
                      isUpdate: false,
                    }),
                  );
                }
                return Promise.resolve(rows).then(onFulfilled, onRejected);
              } else {
                // Note: optimistic assumption that no conflict exists
                // because error is recovered at flush time
                checkTableAccess(table, "insert", values, chainId);
                const result = indexingCache.set({
                  table,
                  key: values,
                  row: values,
                  isUpdate: false,
                });
                return Promise.resolve(result).then(onFulfilled, onRejected);
              }
            },
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
        set: async (values: any) => {
          common.metrics.ponder_indexing_store_queries_total.inc({
            table: getTableName(table),
            method: "update",
          });
          checkOnchainTable(table, "update");
          checkTableAccess(table, "update", key, chainId);

          const row = await indexingCache.get({ table, key, db });

          if (row === null) {
            const error = new RecordNotFoundError(
              `No existing record found in table '${getTableName(table)}'`,
            );
            error.meta.push(`db.update arguments:\n${prettyPrint(key)}`);
            throw error;
          }

          if (typeof values === "function") {
            const set = validateUpdateSet(table, values(row), row);
            for (const [key, value] of Object.entries(set)) {
              if (value === undefined) continue;
              row[key] = value;
            }
          } else {
            const set = validateUpdateSet(table, values, row);
            for (const [key, value] of Object.entries(set)) {
              if (value === undefined) continue;
              row[key] = value;
            }
          }

          checkTableAccess(table, "update", row, chainId);
          return indexingCache.set({ table, key, row, isUpdate: true });
        },
      };
    },
    // @ts-ignore
    delete: async (table: Table, key) => {
      common.metrics.ponder_indexing_store_queries_total.inc({
        table: getTableName(table),
        method: "delete",
      });
      checkOnchainTable(table, "delete");
      checkTableAccess(table, "delete", key, chainId);
      return indexingCache.delete({ table, key, db });
    },
    // @ts-ignore
    sql: drizzle(
      async (_sql, params, method, typings) => {
        let isSelectOnly = false;
        if (chainId !== undefined)
          throw new InvalidStoreMethodError(
            `Raw SQL queries are not allowed in 'isolated' ordering.`,
          );
        try {
          await validateQuery(_sql, false);
          isSelectOnly = true;
        } catch {}

        if (isSelectOnly === false) {
          await indexingCache.flush({ client });
          indexingCache.invalidate();
          indexingCache.clear();
        } else {
          // Note: Not all nodes are implemented in the parser,
          // so we need to try/catch to avoid throwing an error.
          let tableNames: Set<string> | undefined;
          try {
            tableNames = await findTableNames(_sql);
          } catch {}

          await indexingCache.flush({ client, tableNames });
        }

        const query: QueryWithTypings = { sql: _sql, params, typings };
        const endClock = startClock();

        try {
          const result = await db._.session
            .prepareQuery(query, undefined, undefined, method === "all")
            .execute();

          // @ts-ignore
          return { rows: result.rows.map((row) => Object.values(row)) };
        } catch (error) {
          throw parseSqlError(error);
        } finally {
          common.metrics.ponder_indexing_store_raw_sql_duration.observe(
            endClock(),
          );
        }
      },
      { schema, casing: "snake_case" },
    ),
  };
};
