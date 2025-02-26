import type { Common } from "@/internal/common.js";
import { RecordNotFoundError } from "@/internal/errors.js";
import type { Event, Schema, SchemaBuild } from "@/internal/types.js";
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
  parseSqlError,
} from "./index.js";

export const createHistoricalIndexingStore = ({
  common,
  schemaBuild: { schema },
  indexingCache,
  db,
  client,
}: {
  common: Common;
  schemaBuild: Pick<SchemaBuild, "schema">;
  indexingCache: IndexingCache;
  db: Drizzle<Schema>;
  client: PoolClient | PGlite;
}): IndexingStore => {
  let event: Event | undefined;

  return {
    // @ts-ignore
    find: (table: Table, key) => {
      common.metrics.ponder_indexing_store_queries_total.inc({
        table: getTableName(table),
        method: "find",
      });
      checkOnchainTable(table, "find");
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
                        metadata: { event },
                      }),
                    );
                  }
                }
                return rows;
              } else {
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
                  metadata: { event },
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
                      for (const [key, value] of Object.entries(valuesU(row))) {
                        if (value === undefined) continue;
                        row[key] = value;
                      }
                    } else {
                      for (const [key, value] of Object.entries(valuesU)) {
                        if (value === undefined) continue;
                        row[key] = value;
                      }
                    }
                    rows.push(
                      indexingCache.set({
                        table,
                        key: value,
                        row,
                        isUpdate: true,
                        metadata: { event },
                      }),
                    );
                  } else {
                    rows.push(
                      indexingCache.set({
                        table,
                        key: value,
                        row: value,
                        isUpdate: false,
                        metadata: { event },
                      }),
                    );
                  }
                }
                return rows;
              } else {
                const row = await indexingCache.get({
                  table,
                  key: values,
                  db,
                });

                if (row) {
                  if (typeof valuesU === "function") {
                    for (const [key, value] of Object.entries(valuesU(row))) {
                      if (value === undefined) continue;
                      row[key] = value;
                    }
                  } else {
                    for (const [key, value] of Object.entries(valuesU)) {
                      if (value === undefined) continue;
                      row[key] = value;
                    }
                  }
                  return indexingCache.set({
                    table,
                    key: values,
                    row,
                    isUpdate: true,
                    metadata: { event },
                  });
                }

                return indexingCache.set({
                  table,
                  key: values,
                  row: values,
                  isUpdate: false,
                  metadata: { event },
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

                  rows.push(
                    indexingCache.set({
                      table,
                      key: value,
                      row: value,
                      isUpdate: false,
                      metadata: { event },
                    }),
                  );
                }
                return Promise.resolve(rows).then(onFulfilled, onRejected);
              } else {
                // Note: optimistic assumption that no conflict exists
                // because error is recovered at flush time

                const result = indexingCache.set({
                  table,
                  key: values,
                  row: values,
                  isUpdate: false,
                  metadata: { event },
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

          const row = await indexingCache.get({ table, key, db });

          if (row === null) {
            const error = new RecordNotFoundError(
              `No existing record found in table '${getTableName(table)}'`,
            );
            error.meta.push(`db.update arguments:\n${prettyPrint(key)}`);
            throw error;
          }

          if (typeof values === "function") {
            for (const [key, value] of Object.entries(values(row))) {
              if (value === undefined) continue;
              row[key] = value;
            }
          } else {
            for (const [key, value] of Object.entries(values)) {
              if (value === undefined) continue;
              row[key] = value;
            }
          }

          return indexingCache.set({
            table,
            key,
            row,
            isUpdate: true,
            metadata: { event },
          });
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
      return indexingCache.delete({ table, key, db });
    },
    // @ts-ignore
    sql: drizzle(
      async (_sql, params, method, typings) => {
        await indexingCache.flush({ client });
        indexingCache.invalidate();

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
    set event(_event: Event | undefined) {
      event = _event;
    },
  };
};
