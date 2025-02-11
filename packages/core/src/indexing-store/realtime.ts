import type { Database } from "@/database/index.js";
import { getPrimaryKeyColumns } from "@/drizzle/index.js";
import type { Common } from "@/internal/common.js";
import { RecordNotFoundError } from "@/internal/errors.js";
import type { SchemaBuild } from "@/internal/types.js";
import { prettyPrint } from "@/utils/print.js";
import { createQueue } from "@/utils/queue.js";
import { type QueryWithTypings, type Table, getTableName } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pg-proxy";
import { getCacheKey, getWhereCondition } from "./cache.js";
import {
  type IndexingStore,
  checkOnchainTable,
  parseSqlError,
} from "./index.js";

export const createRealtimeIndexingStore = ({
  schemaBuild: { schema },
  database,
}: {
  common: Common;
  schemaBuild: Pick<SchemaBuild, "schema">;
  database: Database;
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
      queue.add(() =>
        database.wrap(
          { method: `${getTableName(table) ?? "unknown"}.find()` },
          async () => {
            checkOnchainTable(table, "find");

            return find(table, key);
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

                    const parseResult = (result: { [x: string]: any }[]) => {
                      if (Array.isArray(values) === false) {
                        return result.length === 1 ? result[0] : null;
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

                    if (typeof valuesU === "object") {
                      try {
                        return await database.qb.drizzle
                          .insert(table)
                          .values(values)
                          .onConflictDoUpdate({
                            target: getPrimaryKeyColumns(table).map(
                              // @ts-ignore
                              ({ js }) => table[js],
                            ),
                            set: valuesU,
                          })
                          .returning()
                          .then((res) =>
                            Array.isArray(values) ? res : res[0],
                          );
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
                            rows.push(
                              await database.qb.drizzle
                                .update(table)
                                .set(valuesU(row))
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
                          return await database.qb.drizzle
                            .update(table)
                            .set(valuesU(row))
                            .where(getWhereCondition(table, values))
                            .returning()
                            .then((res) => res[0]);
                        } catch (e) {
                          throw parseSqlError(e);
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
                  database.wrap(
                    {
                      method: `${getTableName(table) ?? "unknown"}.insert()`,
                    },
                    async () => {
                      checkOnchainTable(table, "insert");

                      try {
                        return await database.qb.drizzle
                          .insert(table)
                          .values(values)
                          .returning()
                          .then((res) =>
                            Array.isArray(values) ? res : res[0],
                          );
                      } catch (e) {
                        throw parseSqlError(e);
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

                if (typeof values === "function") {
                  const row = await find(table, key);

                  if (row === null) {
                    const error = new RecordNotFoundError(
                      `No existing record found in table '${getTableName(table)}'`,
                    );
                    error.meta.push(
                      `db.update arguments:\n${prettyPrint(key)}`,
                    );
                    throw error;
                  }

                  try {
                    return await database.qb.drizzle
                      .update(table)
                      .set(values(row))
                      .where(getWhereCondition(table, key))
                      .returning()
                      .then((res) => res[0]);
                  } catch (e) {
                    throw parseSqlError(e);
                  }
                } else {
                  try {
                    return await database.qb.drizzle
                      .update(table)
                      .set(values)
                      .where(getWhereCondition(table, key))
                      .returning()
                      .then((res) => res[0]);
                  } catch (e) {
                    throw parseSqlError(e);
                  }
                }
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

            const deleted = await database.qb.drizzle
              .delete(table)
              .where(getWhereCondition(table, key))
              .returning();

            return deleted.length > 0;
          },
        ),
      ),
    // @ts-ignore
    sql: drizzle(
      (_sql, params, method, typings) =>
        // @ts-ignore
        queue.add(async () => {
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
        }),
      { schema, casing: "snake_case" },
    ),
  };
};
