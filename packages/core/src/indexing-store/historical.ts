import type { Database } from "@/database/index.js";
import type { Common } from "@/internal/common.js";
import { RecordNotFoundError } from "@/internal/errors.js";
import type { Event, Schema, SchemaBuild } from "@/internal/types.js";
import type { Drizzle } from "@/types/db.js";
import { prettyPrint } from "@/utils/print.js";
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
  database,
  schemaBuild: { schema },
  indexingCache,
  db,
  client,
}: {
  common: Common;
  database: Database;
  schemaBuild: Pick<SchemaBuild, "schema">;
  indexingCache: IndexingCache;
  db: Drizzle<Schema>;
  client: PoolClient | PGlite;
}): IndexingStore => {
  let event: Event | undefined;

  return {
    // @ts-ignore
    find: (table: Table, key) =>
      database.record(
        {
          method: `${getTableName(table) ?? "unknown"}.find()`,
        },
        async () => {
          checkOnchainTable(table, "find");
          return indexingCache.get({ table, key, db });
        },
      ),
    // @ts-ignore
    insert(table: Table) {
      return {
        values: (values: any) => {
          // @ts-ignore
          const inner = {
            onConflictDoNothing: () =>
              database.record(
                {
                  method: `${getTableName(table) ?? "unknown"}.insert()`,
                },
                async () => {
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
              ),
            onConflictDoUpdate: (valuesU: any) =>
              database.record(
                {
                  method: `${getTableName(table) ?? "unknown"}.insert()`,
                },
                async () => {
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
                          for (const [key, value] of Object.entries(
                            valuesU(row),
                          )) {
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
                        for (const [key, value] of Object.entries(
                          valuesU(row),
                        )) {
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
              ),
            // biome-ignore lint/suspicious/noThenProperty: <explanation>
            then: (onFulfilled, onRejected) =>
              database
                .record(
                  {
                    method: `${getTableName(table) ?? "unknown"}.insert()`,
                  },
                  async () => {
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
                      return rows;
                    } else {
                      // Note: optimistic assumption that no conflict exists
                      // because error is recovered at flush time

                      return indexingCache.set({
                        table,
                        key: values,
                        row: values,
                        isUpdate: false,
                        metadata: { event },
                      });
                    }
                  },
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
          database.record(
            {
              method: `${getTableName(table) ?? "unknown"}.update()`,
            },
            async () => {
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
          ),
      };
    },
    // @ts-ignore
    delete: (table: Table, key) =>
      database.record(
        {
          method: `${getTableName(table) ?? "unknown"}.delete()`,
        },
        async () => {
          checkOnchainTable(table, "delete");
          return indexingCache.delete({ table, key, db });
        },
      ),
    // @ts-ignore
    sql: drizzle(
      async (_sql, params, method, typings) => {
        await indexingCache.flush({ client });
        indexingCache.invalidate();

        const query: QueryWithTypings = { sql: _sql, params, typings };

        const res = await database.record({ method: "sql" }, async () => {
          try {
            return await db._.session
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
    set event(_event: Event | undefined) {
      event = _event;
    },
  };
};
