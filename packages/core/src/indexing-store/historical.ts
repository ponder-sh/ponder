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
import { copy, copyOnWrite } from "@/utils/copy.js";
import { createLock } from "@/utils/mutex.js";
import { prettyPrint } from "@/utils/print.js";
import { getSQLQueryRelations, isReadonlySQLQuery } from "@/utils/sql-parse.js";
import { startClock } from "@/utils/timer.js";
import {
  type QueryWithTypings,
  type Table,
  getTableName,
  getViewName,
  isTable,
  isView,
} from "drizzle-orm";
import { drizzle } from "drizzle-orm/pg-proxy";
import type { IndexingCache, Row } from "./cache.js";
import {
  type IndexingStore,
  checkOnchainTable,
  checkTableAccess,
  validateUpdateSet,
} from "./index.js";
import { getPrimaryKeyCache } from "./utils.js";

export const createHistoricalIndexingStore = ({
  common,
  schemaBuild: { schema },
  indexingCache,
  indexingErrorHandler,
  chainId,
}: {
  common: Common;
  schemaBuild: Pick<SchemaBuild, "schema">;
  indexingCache: IndexingCache;
  indexingErrorHandler: IndexingErrorHandler;
  chainId?: number;
}): IndexingStore => {
  let qb: QB = undefined!;
  let isProcessingEvents = true;

  const tables = Object.values(schema).filter(isTable);
  const views = Object.values(schema).filter(isView);
  const primaryKeyCache = getPrimaryKeyCache(tables);

  const lock = createLock();

  const storeMethodWrapper = (fn: (...args: any[]) => Promise<any>) => {
    return async (...args: any[]) => {
      try {
        if (isProcessingEvents === false) {
          throw new NonRetryableUserError(
            "A store API method (find, update, insert, delete) was called after the indexing function returned. Hint: Did you forget to await the store API method call (an unawaited promise)?",
          );
        }
        await lock.lock();
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
      } finally {
        lock.unlock();
      }
    };
  };

  // Note: the naming convention is used to separate user space from ponder space.
  // "user" prefix is user space, "ponder" prefix is ponder space.

  return {
    // @ts-ignore
    find: storeMethodWrapper(async (table: Table, key) => {
      common.metrics.ponder_indexing_store_queries_total.inc({
        table: getTableName(table),
        method: "find",
      });
      checkOnchainTable(table, "find");
      checkTableAccess(table, "find", key, chainId);
      const ponderRow = await indexingCache.get({ table, key });
      const userRow = ponderRow === null ? null : copyOnWrite(ponderRow);
      return userRow;
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

              const ponderValues = copy(userValues);

              if (Array.isArray(ponderValues)) {
                const ponderRows = [];
                for (const value of ponderValues) {
                  checkTableAccess(table, "insert", value, chainId);
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
                const userRows = ponderRows.map((row) =>
                  row === null ? row : copyOnWrite(row),
                );
                return userRows;
              } else {
                checkTableAccess(table, "insert", ponderValues, chainId);
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

                const userRow = copyOnWrite(ponderRow);
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
                    checkTableAccess(table, "insert", value, chainId);
                    const ponderRowUpdate = await indexingCache.get({
                      table,
                      key: value,
                    });

                    if (ponderRowUpdate) {
                      if (typeof userUpdateValues === "function") {
                        const userRowUpdate = copyOnWrite(ponderRowUpdate);
                        const userSet = userUpdateValues(userRowUpdate);
                        const ponderSet = copy(userSet);
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
                        const ponderSet = copy(userSet);
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
                          key: ponderRowUpdate,
                          row: ponderRowUpdate,
                          isUpdate: true,
                        }),
                      );
                    } else {
                      const ponderValue = copy(value);
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
                  const userRows = ponderRows.map((row) =>
                    row === null ? row : copyOnWrite(row),
                  );
                  return userRows;
                } else {
                  checkTableAccess(table, "insert", userValues, chainId);
                  const ponderRowUpdate = await indexingCache.get({
                    table,
                    key: userValues,
                  });

                  if (ponderRowUpdate) {
                    if (typeof userUpdateValues === "function") {
                      const userRowUpdate = copyOnWrite(ponderRowUpdate);
                      const userSet = userUpdateValues(userRowUpdate);
                      const ponderSet = copy(userSet);
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
                      const ponderSet = copy(userSet);
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
                      key: ponderRowUpdate,
                      row: ponderRowUpdate,
                      isUpdate: true,
                    });
                    const userRow = copyOnWrite(ponderRow);
                    return userRow;
                  }

                  const ponderValues = copy(userValues);

                  const ponderRowInsert = indexingCache.set({
                    table,
                    key: ponderValues,
                    row: ponderValues,
                    isUpdate: false,
                  });

                  const userRow = copyOnWrite(ponderRowInsert);
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
                const ponderValues = copy(userValues);

                if (Array.isArray(ponderValues)) {
                  const ponderRows = [];
                  for (const value of ponderValues) {
                    checkTableAccess(table, "insert", value, chainId);

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
                  const userRows = ponderRows.map((row) =>
                    row === null ? row : copyOnWrite(row),
                  );
                  return Promise.resolve(userRows).then(
                    onFulfilled,
                    onRejected,
                  );
                } else {
                  checkTableAccess(table, "insert", ponderValues, chainId);

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
                  const userRow = copyOnWrite(ponderRow);
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
          checkTableAccess(table, "update", key, chainId);

          const ponderRowUpdate = await indexingCache.get({ table, key });

          if (ponderRowUpdate === null) {
            const error = new RecordNotFoundError(
              `No existing record found in table '${getTableName(table)}'`,
            );
            error.meta.push(`db.update arguments:\n${prettyPrint(key)}`);
            throw error;
          }

          if (typeof userValues === "function") {
            const userRow = copyOnWrite(ponderRowUpdate);
            const userSet = userValues(userRow);
            const ponderSet = copy(userSet);
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
            const ponderSet = copy(userSet);
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
            key: ponderRowUpdate,
            row: ponderRowUpdate,
            isUpdate: true,
          });
          const userRow = copyOnWrite(ponderRow);
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
      checkTableAccess(table, "delete", key, chainId);
      return indexingCache.delete({ table, key });
    }),
    // @ts-ignore
    sql: drizzle(
      storeMethodWrapper(async (_sql, params, method, typings) => {
        const isSelectOnly = await isReadonlySQLQuery(_sql);

        if (isSelectOnly === false) {
          await indexingCache.flush();
          indexingCache.invalidate();
          indexingCache.clear();
        } else {
          // Note: Not all nodes are implemented in the parser,
          // so we need to try/catch to avoid throwing an error.
          let relations: Set<string> | undefined;
          try {
            relations = await getSQLQueryRelations(_sql);
          } catch {}

          if (
            Array.from(relations ?? []).some((refName) =>
              views.some((view) => getViewName(view) === refName),
            )
          ) {
            await indexingCache.flush();
          } else {
            await indexingCache.flush({ tableNames: relations });
          }
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

            if (method === "all") {
              return {
                // @ts-ignore
                ...result,
                // @ts-ignore
                rows: result.rows.map((row) => Object.values(row)),
              };
            }

            return result;
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
