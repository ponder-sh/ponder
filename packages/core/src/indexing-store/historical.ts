import { findTableNames, validateQuery } from "@/client/parse.js";
import type { QB } from "@/database/queryBuilder.js";
import type { Common } from "@/internal/common.js";
import {
  DbConnectionError,
  NonRetryableUserError,
  RawSqlError,
  RecordNotFoundError,
  RetryableError,
  UniqueConstraintError,
} from "@/internal/errors.js";
import type { IndexingErrorHandler, SchemaBuild } from "@/internal/types.js";
import { prettyPrint } from "@/utils/print.js";
import { startClock } from "@/utils/timer.js";
import {
  type QueryWithTypings,
  type Table,
  getTableName,
  isTable,
} from "drizzle-orm";
import { drizzle } from "drizzle-orm/pg-proxy";
import type { IndexingCache, Row } from "./cache.js";
import {
  type IndexingStore,
  checkOnchainTable,
  validateUpdateSet,
} from "./index.js";
import { getPrimaryKeyCache } from "./utils.js";

export const createHistoricalIndexingStore = ({
  common,
  schemaBuild: { schema },
  indexingCache,
  indexingErrorHandler,
}: {
  common: Common;
  schemaBuild: Pick<SchemaBuild, "schema">;
  indexingCache: IndexingCache;
  indexingErrorHandler: IndexingErrorHandler;
}): IndexingStore => {
  let qb: QB = undefined!;
  let isProcessingEvents = true;

  const tables = Object.values(schema).filter(isTable);
  const primaryKeyCache = getPrimaryKeyCache(tables);

  const storeMethodWrapper = (fn: (...args: any[]) => Promise<any>) => {
    return async (...args: any[]) => {
      try {
        if (isProcessingEvents === false) {
          throw new NonRetryableUserError(
            "A store API method (find, update, insert, delete) was called after the indexing function returned. Hint: Did you forget to await the store API method call (an unawaited promise)?",
          );
        }
        const result = await fn(...args);
        // @ts-expect-error typescript bug lol
        if (isProcessingEvents === false) {
          throw new NonRetryableUserError(
            "A store API method (find, update, insert, delete) was called after the indexing function returned. Hint: Did you forget to await the store API method call (an unawaited promise)?",
          );
        }
        return result;
      } catch (error) {
        if (isProcessingEvents === false) {
          throw new NonRetryableUserError(
            "A store API method (find, update, insert, delete) was called after the indexing function returned. Hint: Did you forget to await the store API method call (an unawaited promise)?",
          );
        }

        if (error instanceof RetryableError) {
          indexingErrorHandler.setRetryableError(error);
        }

        throw error;
      }
    };
  };

  // Note: the naming convention is used to separate user space from ponder space.
  // "user" prefix is user space, "ponder" prefix is ponder space.

  return {
    // @ts-ignore
    find: storeMethodWrapper((table: Table, key) => {
      common.metrics.ponder_indexing_store_queries_total.inc({
        table: getTableName(table),
        method: "find",
      });
      checkOnchainTable(table, "find");
      return indexingCache.get({ table, key });
    }),

    // @ts-ignore
    insert(table: Table) {
      return {
        values: (userValues: any) => {
          // @ts-ignore
          const inner = {
            onConflictDoNothing: storeMethodWrapper(async () => {
              common.metrics.ponder_indexing_store_queries_total.inc({
                table: getTableName(table),
                method: "insert",
              });
              checkOnchainTable(table, "insert");

              const ponderValues = structuredClone(userValues);

              if (Array.isArray(ponderValues)) {
                const ponderRows = [];
                for (const value of ponderValues) {
                  const row = await indexingCache.get({ table, key: value });

                  if (row) {
                    ponderRows.push(null);
                  } else {
                    ponderRows.push(
                      indexingCache.set({
                        table,
                        key: value,
                        row: value,
                        isUpdate: false,
                      }),
                    );
                  }
                }
                const userRows = structuredClone(ponderRows);
                return userRows;
              } else {
                const row = await indexingCache.get({
                  table,
                  key: ponderValues,
                });

                if (row) {
                  return null;
                }

                const ponderRow = indexingCache.set({
                  table,
                  key: ponderValues,
                  row: ponderValues,
                  isUpdate: false,
                });

                const userRow = structuredClone(ponderRow);
                return userRow;
              }
            }),
            onConflictDoUpdate: storeMethodWrapper(
              async (userUpdateValues: any) => {
                common.metrics.ponder_indexing_store_queries_total.inc({
                  table: getTableName(table),
                  method: "insert",
                });
                checkOnchainTable(table, "insert");

                if (Array.isArray(userValues)) {
                  const ponderRows: Row[] = [];
                  for (const value of userValues) {
                    const ponderRowUpdate = await indexingCache.get({
                      table,
                      key: value,
                    });

                    if (ponderRowUpdate) {
                      if (typeof userUpdateValues === "function") {
                        const userRowUpdate = structuredClone(ponderRowUpdate);
                        const userSet = userUpdateValues(userRowUpdate);
                        const ponderSet = structuredClone(userSet);
                        validateUpdateSet(
                          table,
                          ponderSet,
                          ponderRowUpdate,
                          primaryKeyCache,
                        );
                        for (const [key, value] of Object.entries(ponderSet)) {
                          if (value === undefined) continue;
                          ponderRowUpdate[key] = value;
                        }
                      } else {
                        const userSet = userUpdateValues;
                        const ponderSet = structuredClone(userSet);
                        validateUpdateSet(
                          table,
                          ponderSet,
                          ponderRowUpdate,
                          primaryKeyCache,
                        );
                        for (const [key, value] of Object.entries(ponderSet)) {
                          if (value === undefined) continue;
                          ponderRowUpdate[key] = value;
                        }
                      }
                      ponderRows.push(
                        indexingCache.set({
                          table,
                          key: value,
                          row: ponderRowUpdate,
                          isUpdate: true,
                        }),
                      );
                    } else {
                      const ponderValue = structuredClone(value);
                      ponderRows.push(
                        indexingCache.set({
                          table,
                          key: ponderValue,
                          row: ponderValue,
                          isUpdate: false,
                        }),
                      );
                    }
                  }
                  const userRows = structuredClone(ponderRows);
                  return userRows;
                } else {
                  const ponderRowUpdate = await indexingCache.get({
                    table,
                    key: userValues,
                  });

                  if (ponderRowUpdate) {
                    if (typeof userUpdateValues === "function") {
                      const userRowUpdate = structuredClone(ponderRowUpdate);
                      const userSet = userUpdateValues(userRowUpdate);
                      const ponderSet = structuredClone(userSet);
                      validateUpdateSet(
                        table,
                        ponderSet,
                        ponderRowUpdate,
                        primaryKeyCache,
                      );
                      for (const [key, value] of Object.entries(ponderSet)) {
                        if (value === undefined) continue;
                        ponderRowUpdate[key] = value;
                      }
                    } else {
                      const userSet = userUpdateValues;
                      const ponderSet = structuredClone(userSet);
                      validateUpdateSet(
                        table,
                        ponderSet,
                        ponderRowUpdate,
                        primaryKeyCache,
                      );
                      for (const [key, value] of Object.entries(ponderSet)) {
                        if (value === undefined) continue;
                        ponderRowUpdate[key] = value;
                      }
                    }
                    const ponderRow = indexingCache.set({
                      table,
                      key: userValues,
                      row: ponderRowUpdate,
                      isUpdate: true,
                    });
                    const userRow = structuredClone(ponderRow);
                    return userRow;
                  }

                  const ponderValues = structuredClone(userValues);

                  const ponderRowInsert = indexingCache.set({
                    table,
                    key: ponderValues,
                    row: ponderValues,
                    isUpdate: false,
                  });

                  const userRow = structuredClone(ponderRowInsert);
                  return userRow;
                }
              },
            ),
            // biome-ignore lint/suspicious/noThenProperty: <explanation>
            then: (onFulfilled, onRejected) =>
              storeMethodWrapper(async () => {
                common.metrics.ponder_indexing_store_queries_total.inc({
                  table: getTableName(table),
                  method: "insert",
                });
                checkOnchainTable(table, "insert");
                const ponderValues = structuredClone(userValues);

                if (Array.isArray(ponderValues)) {
                  const ponderRows = [];
                  for (const value of ponderValues) {
                    if (qb.$dialect === "pglite") {
                      const row = await indexingCache.get({
                        table,
                        key: value,
                      });

                      if (row) {
                        throw new UniqueConstraintError(
                          `Primary key conflict in table '${getTableName(table)}'`,
                        );
                      } else {
                        ponderRows.push(
                          indexingCache.set({
                            table,
                            key: value,
                            row: value,
                            isUpdate: false,
                          }),
                        );
                      }
                    } else {
                      // Note: optimistic assumption that no conflict exists
                      // because error is recovered at flush time

                      ponderRows.push(
                        indexingCache.set({
                          table,
                          key: value,
                          row: value,
                          isUpdate: false,
                        }),
                      );
                    }
                  }
                  const userRows = structuredClone(ponderRows);
                  return Promise.resolve(userRows).then(
                    onFulfilled,
                    onRejected,
                  );
                } else {
                  let ponderRow: Row;
                  if (qb.$dialect === "pglite") {
                    const row = await indexingCache.get({
                      table,
                      key: ponderValues,
                    });

                    if (row) {
                      throw new UniqueConstraintError(
                        `Primary key conflict in table '${getTableName(table)}'`,
                      );
                    } else {
                      ponderRow = indexingCache.set({
                        table,
                        key: ponderValues,
                        row: ponderValues,
                        isUpdate: false,
                      });
                    }
                  } else {
                    // Note: optimistic assumption that no conflict exists
                    // because error is recovered at flush time

                    ponderRow = indexingCache.set({
                      table,
                      key: ponderValues,
                      row: ponderValues,
                      isUpdate: false,
                    });
                  }
                  const userRow = structuredClone(ponderRow);
                  return Promise.resolve(userRow).then(onFulfilled, onRejected);
                }
              })().then(onFulfilled, onRejected),
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
        set: storeMethodWrapper(async (userValues: any) => {
          common.metrics.ponder_indexing_store_queries_total.inc({
            table: getTableName(table),
            method: "update",
          });
          checkOnchainTable(table, "update");

          const ponderRowUpdate = await indexingCache.get({ table, key });

          if (ponderRowUpdate === null) {
            const error = new RecordNotFoundError(
              `No existing record found in table '${getTableName(table)}'`,
            );
            error.meta.push(`db.update arguments:\n${prettyPrint(key)}`);
            throw error;
          }

          if (typeof userValues === "function") {
            const userRow = structuredClone(ponderRowUpdate);
            const userSet = userValues(userRow);
            const ponderSet = structuredClone(userSet);
            validateUpdateSet(
              table,
              ponderSet,
              ponderRowUpdate,
              primaryKeyCache,
            );
            for (const [key, value] of Object.entries(ponderSet)) {
              if (value === undefined) continue;
              ponderRowUpdate[key] = value;
            }
          } else {
            const userSet = userValues;
            const ponderSet = structuredClone(userSet);
            validateUpdateSet(
              table,
              ponderSet,
              ponderRowUpdate,
              primaryKeyCache,
            );
            for (const [key, value] of Object.entries(ponderSet)) {
              if (value === undefined) continue;
              ponderRowUpdate[key] = value;
            }
          }

          const ponderRow = indexingCache.set({
            table,
            key,
            row: ponderRowUpdate,
            isUpdate: true,
          });
          const userRow = structuredClone(ponderRow);
          return userRow;
        }),
      };
    },
    // @ts-ignore
    delete: storeMethodWrapper(async (table: Table, key) => {
      common.metrics.ponder_indexing_store_queries_total.inc({
        table: getTableName(table),
        method: "delete",
      });
      checkOnchainTable(table, "delete");
      return indexingCache.delete({ table, key });
    }),
    // @ts-ignore
    sql: drizzle(
      storeMethodWrapper(async (_sql, params, method, typings) => {
        let isSelectOnly = false;
        try {
          await validateQuery(_sql, false);
          isSelectOnly = true;
        } catch {}

        if (isSelectOnly === false) {
          await indexingCache.flush();
          indexingCache.invalidate();
          indexingCache.clear();
        } else {
          // Note: Not all nodes are implemented in the parser,
          // so we need to try/catch to avoid throwing an error.
          let tableNames: Set<string> | undefined;
          try {
            tableNames = await findTableNames(_sql);
          } catch {}

          await indexingCache.flush({ tableNames });
        }

        const query: QueryWithTypings = { sql: _sql, params, typings };
        const endClock = startClock();

        try {
          // Note: Use transaction so that user-land queries don't affect the
          // in-progress transaction.
          return await qb.transaction(async (tx) => {
            const result = await tx.wrap((tx) =>
              tx._.session
                .prepareQuery(query, undefined, undefined, method === "all")
                .execute(),
            );

            // @ts-ignore
            return { rows: result.rows.map((row) => Object.values(row)) };
          });
        } catch (error) {
          if (error instanceof DbConnectionError) {
            throw error;
          }

          throw new RawSqlError((error as Error).message);
        } finally {
          common.metrics.ponder_indexing_store_raw_sql_duration.observe(
            endClock(),
          );
        }
      }),
      { schema, casing: "snake_case" },
    ),
    set qb(_qb: QB) {
      qb = _qb;
    },
    set isProcessingEvents(_isProcessingEvents: boolean) {
      isProcessingEvents = _isProcessingEvents;
    },
  };
};
