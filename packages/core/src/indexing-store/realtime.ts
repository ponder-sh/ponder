import type { Database } from "@/database/index.js";
import { getPrimaryKeyColumns } from "@/drizzle/index.js";
import type { Common } from "@/internal/common.js";
import { RecordNotFoundError } from "@/internal/errors.js";
import type { SchemaBuild } from "@/internal/types.js";
import { prettyPrint } from "@/utils/print.js";
import { startClock } from "@/utils/timer.js";
import { type QueryWithTypings, type Table, getTableName } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pg-proxy";
import {
  type IndexingStore,
  checkOnchainTable,
  parseSqlError,
  validateUpdateSet,
} from "./index.js";
import { getCacheKey, getWhereCondition } from "./utils.js";

export const createRealtimeIndexingStore = ({
  common,
  schemaBuild: { schema },
  database,
}: {
  common: Common;
  schemaBuild: Pick<SchemaBuild, "schema">;
  database: Database;
}): IndexingStore => {
  const find = (table: Table, key: object) => {
    return database.qb.drizzle
      .select()
      .from(table)
      .where(getWhereCondition(table, key))
      .then((res) => (res.length === 0 ? null : res[0]!));
  };

  return {
    // @ts-ignore
    find: (table: Table, key) =>
      database.retry(async () => {
        common.metrics.ponder_indexing_store_queries_total.inc({
          table: getTableName(table),
          method: "find",
        });
        checkOnchainTable(table, "find");
        return find(table, key);
      }),
    // @ts-ignore
    insert(table: Table) {
      return {
        values: (values: any) => {
          // @ts-ignore
          const inner = {
            onConflictDoNothing: () =>
              database.retry(async () => {
                common.metrics.ponder_indexing_store_queries_total.inc({
                  table: getTableName(table),
                  method: "insert",
                });
                checkOnchainTable(table, "insert");

                const parseResult = (result: { [x: string]: any }[]) => {
                  if (Array.isArray(values) === false) {
                    return result.length === 1 ? result[0] : null;
                  }

                  if (result.length === 0) {
                    return new Array(values.length).fill(null);
                  }

                  const rows = [];
                  let resultIndex = 0;

                  for (let i = 0; i < values.length; i++) {
                    if (
                      getCacheKey(table, values[i]) ===
                      getCacheKey(table, result[resultIndex]!)
                    ) {
                      rows.push(result[resultIndex++]!);
                    } else {
                      rows.push(null);
                    }
                  }

                  return rows;
                };

                try {
                  return await database.qb.drizzle
                    .insert(table)
                    .values(values)
                    .onConflictDoNothing()
                    .returning()
                    .then(parseResult);
                } catch (e) {
                  throw parseSqlError(e);
                }
              }),
            onConflictDoUpdate: (valuesU: any) =>
              database.retry(async () => {
                common.metrics.ponder_indexing_store_queries_total.inc({
                  table: getTableName(table),
                  method: "insert",
                });
                checkOnchainTable(table, "insert");

                if (typeof valuesU === "object") {
                  try {
                    const set = validateUpdateSet(table, valuesU);
                    return await database.qb.drizzle
                      .insert(table)
                      .values(values)
                      .onConflictDoUpdate({
                        target: getPrimaryKeyColumns(table).map(
                          // @ts-ignore
                          ({ js }) => table[js],
                        ),
                        set,
                      })
                      .returning()
                      .then((res) => (Array.isArray(values) ? res : res[0]));
                  } catch (e) {
                    throw parseSqlError(e);
                  }
                }

                if (Array.isArray(values)) {
                  const rows = [];
                  for (const value of values) {
                    const row = await find(table, value);

                    if (row === null) {
                      try {
                        rows.push(
                          await database.qb.drizzle
                            .insert(table)
                            .values(value)
                            .returning()
                            .then((res) => res[0]),
                        );
                      } catch (e) {
                        throw parseSqlError(e);
                      }
                    } else {
                      try {
                        const set = validateUpdateSet(table, valuesU(row));
                        rows.push(
                          await database.qb.drizzle
                            .update(table)
                            .set(set)
                            .where(getWhereCondition(table, value))
                            .returning()
                            .then((res) => res[0]),
                        );
                      } catch (e) {
                        throw parseSqlError(e);
                      }
                    }
                  }
                  return rows;
                } else {
                  const row = await find(table, values);

                  if (row === null) {
                    try {
                      return await database.qb.drizzle
                        .insert(table)
                        .values(values)
                        .returning()
                        .then((res) => res[0]);
                    } catch (e) {
                      throw parseSqlError(e);
                    }
                  } else {
                    try {
                      const set = validateUpdateSet(table, valuesU(row));
                      return await database.qb.drizzle
                        .update(table)
                        .set(set)
                        .where(getWhereCondition(table, values))
                        .returning()
                        .then((res) => res[0]);
                    } catch (e) {
                      throw parseSqlError(e);
                    }
                  }
                }
              }),
            // biome-ignore lint/suspicious/noThenProperty: <explanation>
            then: (onFulfilled, onRejected) =>
              database
                .retry(async () => {
                  common.metrics.ponder_indexing_store_queries_total.inc({
                    table: getTableName(table),
                    method: "insert",
                  });
                  checkOnchainTable(table, "insert");

                  try {
                    return await database.qb.drizzle
                      .insert(table)
                      .values(values)
                      .returning()
                      .then((res) => (Array.isArray(values) ? res : res[0]));
                  } catch (e) {
                    throw parseSqlError(e);
                  }
                })
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
          database.retry(async () => {
            common.metrics.ponder_indexing_store_queries_total.inc({
              table: getTableName(table),
              method: "update",
            });
            checkOnchainTable(table, "update");

            if (typeof values === "function") {
              const row = await find(table, key);

              if (row === null) {
                const error = new RecordNotFoundError(
                  `No existing record found in table '${getTableName(table)}'`,
                );
                error.meta.push(`db.update arguments:\n${prettyPrint(key)}`);
                throw error;
              }

              try {
                const set = validateUpdateSet(table, values(row));
                return await database.qb.drizzle
                  .update(table)
                  .set(set)
                  .where(getWhereCondition(table, key))
                  .returning()
                  .then((res) => res[0]);
              } catch (e) {
                throw parseSqlError(e);
              }
            } else {
              try {
                const set = validateUpdateSet(table, values);
                return await database.qb.drizzle
                  .update(table)
                  .set(set)
                  .where(getWhereCondition(table, key))
                  .returning()
                  .then((res) => res[0]);
              } catch (e) {
                throw parseSqlError(e);
              }
            }
          }),
      };
    },
    // @ts-ignore
    delete: (table: Table, key) =>
      database.retry(async () => {
        common.metrics.ponder_indexing_store_queries_total.inc({
          table: getTableName(table),
          method: "delete",
        });
        checkOnchainTable(table, "delete");

        const deleted = await database.qb.drizzle
          .delete(table)
          .where(getWhereCondition(table, key))
          .returning();

        return deleted.length > 0;
      }),
    // @ts-ignore
    sql: drizzle(
      async (_sql, params, method, typings) => {
        const query: QueryWithTypings = { sql: _sql, params, typings };

        try {
          return await database.retry(async () => {
            const endClock = startClock();

            const result = await database.qb.drizzle._.session
              .prepareQuery(query, undefined, undefined, method === "all")
              .execute()
              .catch((error) => {
                throw parseSqlError(error);
              })
              .finally(() => {
                common.metrics.ponder_indexing_store_raw_sql_duration.observe(
                  endClock(),
                );
              });
            // @ts-ignore
            return { rows: result.rows.map((row) => Object.values(row)) };
          });
        } catch (error) {
          throw parseSqlError(error);
        }
      },
      { schema, casing: "snake_case" },
    ),
  };
};
