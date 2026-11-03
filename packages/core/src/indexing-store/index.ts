import {
  type Column,
  getTableColumns,
  getTableName,
  getViewName,
  isTable,
  isView,
  type QueryWithTypings,
  type Table,
} from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pg-proxy";
import { Effect, FiberSet, type Scope } from "effect";
import type { DbClient } from "@/database/db.js";
import { onchain } from "@/drizzle/onchain.js";
import {
  DbConnectionError,
  InvalidStoreAccessError,
  InvalidStoreMethodError,
  NonRetryableUserError,
  RawSqlError,
  RecordNotFoundError,
  RetryableError,
  UndefinedTableError,
  UniqueConstraintError,
} from "@/internal/errors.js";
import { externalIo } from "@/internal/io.js";
import { Metrics } from "@/internal/metrics.js";
import type {
  IndexingErrorHandler,
  Schema,
  SchemaBuild,
} from "@/internal/types.js";
import type { Db } from "@/types/db.js";
import { copy, copyOnWrite } from "@/utils/copy.js";
import { createLock } from "@/utils/mutex.js";
import { prettyPrint } from "@/utils/print.js";
import { getSQLQueryRelations, isReadonlySQLQuery } from "@/utils/sql-parse.js";
import { startClockEffect } from "@/utils/timer.js";
import type { IndexingCache, Row } from "./cache.js";
import {
  getPrimaryKeyCache,
  normalizeColumn,
  normalizeUpdateSet,
} from "./utils.js";

export type IndexingStore = {
  /** The `context.db` of indexing functions. */
  db: Db<Schema>;
  /** Client for reads and writes, such as the transaction of the current batch. */
  client: DbClient;
  isProcessingEvents: boolean;
};

const isPrimaryKeyValueEqual = (a: unknown, b: unknown) => {
  if (a instanceof Uint8Array && b instanceof Uint8Array) {
    return a.length === b.length && a.every((byte, i) => byte === b[i]);
  }
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime();
  }
  return a === b;
};

export const validateUpdateSet = (
  table: Table,
  set: Object,
  prev: Row,
  cache: Map<Table, [string, Column][]>,
) => {
  const primaryKeys = cache.get(table)!;

  for (let i = 0; i < primaryKeys.length; i++) {
    const [js, column] = primaryKeys[i]!;
    if (js in set) {
      // Note: Noop on the primary keys if they are identical, otherwise throw an error.
      const value = normalizeColumn(column, (set as Row)[js], true);
      if (isPrimaryKeyValueEqual(value, prev[js]) === false) {
        throw new NonRetryableUserError(
          `Primary key column '${js}' cannot be updated`,
        );
      }
    }
  }
};

/** Throw an error if `table` is not an `onchainTable`. */
export const checkOnchainTable = (
  table: Table,
  method: "find" | "insert" | "update" | "delete",
) => {
  if (table === undefined)
    throw new UndefinedTableError(
      `Table object passed to db.${method}() is undefined`,
    );

  if (onchain in table) return;

  throw new InvalidStoreMethodError(
    method === "find"
      ? `db.find() can only be used with onchain tables, and '${getTableConfig(table).name}' is an offchain table or a view.`
      : `Indexing functions can only write to onchain tables, and '${getTableConfig(table).name}' is an offchain table or a view.`,
  );
};

export const checkTableAccess = (
  table: Table,
  method: "find" | "insert" | "update" | "delete",
  key: object,
  chainId?: number,
) => {
  if (chainId === undefined) return;
  if ("chainId" in key && String(key.chainId) === String(chainId)) return;
  throw new InvalidStoreAccessError(
    "chainId" in key
      ? `db.${method}(${getTableConfig(table).name}) cannot access rows on different chains when ordering is 'isolated'.`
      : `db.${method}(${getTableConfig(table).name}) must specify 'chainId' when ordering is 'isolated'.`,
  );
};

/**
 * Create the indexing store.
 *
 * @dev The methods of `db` return promises for indexing functions. Database
 * reads and writes run as fibers that are interrupted when the scope closes.
 */
export const createIndexingStore = ({
  schemaBuild: { schema },
  indexingCache,
  indexingErrorHandler,
  chainId,
}: {
  schemaBuild: Pick<SchemaBuild, "schema">;
  indexingCache: IndexingCache;
  indexingErrorHandler: IndexingErrorHandler;
  chainId?: number;
}): Effect.Effect<IndexingStore, never, Metrics | Scope.Scope> =>
  Effect.gen(function* () {
    const metrics = yield* Metrics;
    const runPromise = yield* FiberSet.makeRuntimePromise();

    let client: DbClient = undefined!;
    let isProcessingEvents = true;

    const tables = Object.values(schema).filter(isTable);
    const views = Object.values(schema).filter(isView);
    const primaryKeyCache = getPrimaryKeyCache(tables);
    const isCopyFast = new Map(
      tables.map((table) => [
        table,
        Object.values(getTableColumns(table)).every((column) =>
          ["string", "number", "boolean", "bigint"].includes(column.dataType),
        ),
      ]),
    );

    const lock = createLock();

    /** Read the row of `table` with `key`, from the cache or the database. */
    const get = (table: Table, key: object) => {
      const row = indexingCache.get({ table, key });
      return Effect.isEffect(row) ? runPromise(row) : row;
    };

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

    const indexingStore: IndexingStore = {
      db: {
        find: storeMethodWrapper(async (table: Table, key) => {
          metrics.incrementIndexingStoreQueries(getTableName(table), "find");
          checkOnchainTable(table, "find");
          checkTableAccess(table, "find", key, chainId);
          const ponderRow = await get(table, key);
          const userRow = ponderRow === null ? null : copyOnWrite(ponderRow);
          return userRow;
        }),
        // @ts-expect-error
        insert(table: Table) {
          return {
            values: (userValues: any) => {
              const inner = {
                onConflictDoNothing: storeMethodWrapper(async () => {
                  metrics.incrementIndexingStoreQueries(
                    getTableName(table),
                    "insert",
                  );
                  checkOnchainTable(table, "insert");

                  const ponderValues = Array.isArray(userValues)
                    ? userValues.map((value) =>
                        copy(value, isCopyFast.get(table)!),
                      )
                    : copy(userValues, isCopyFast.get(table)!);

                  if (Array.isArray(ponderValues)) {
                    const ponderRows = [];
                    for (const value of ponderValues) {
                      checkTableAccess(table, "insert", value, chainId);
                      const row = await get(table, value);

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
                    const row = await get(table, ponderValues);

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
                    metrics.incrementIndexingStoreQueries(
                      getTableName(table),
                      "insert",
                    );
                    checkOnchainTable(table, "insert");

                    if (Array.isArray(userValues)) {
                      const ponderRows: Row[] = [];
                      for (const value of userValues) {
                        checkTableAccess(table, "insert", value, chainId);
                        let ponderRowUpdate = await get(table, value);

                        if (ponderRowUpdate) {
                          ponderRowUpdate = copy(
                            ponderRowUpdate,
                            isCopyFast.get(table)!,
                          );
                          if (typeof userUpdateValues === "function") {
                            const userRowUpdate = copyOnWrite(ponderRowUpdate);
                            const userSet = userUpdateValues(userRowUpdate);
                            const ponderSet = copy(
                              userSet,
                              isCopyFast.get(table)!,
                            );
                            validateUpdateSet(
                              table,
                              ponderSet,
                              ponderRowUpdate,
                              primaryKeyCache,
                            );
                            normalizeUpdateSet(table, ponderSet);
                            for (const [key, value] of Object.entries(
                              ponderSet,
                            )) {
                              if (value === undefined) continue;
                              ponderRowUpdate[key] = value;
                            }
                          } else {
                            const userSet = userUpdateValues;
                            const ponderSet = copy(
                              userSet,
                              isCopyFast.get(table)!,
                            );
                            validateUpdateSet(
                              table,
                              ponderSet,
                              ponderRowUpdate,
                              primaryKeyCache,
                            );
                            normalizeUpdateSet(table, ponderSet);
                            for (const [key, value] of Object.entries(
                              ponderSet,
                            )) {
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
                          const ponderValue = copy(
                            value,
                            isCopyFast.get(table)!,
                          );
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
                      let ponderRowUpdate = await get(table, userValues);

                      if (ponderRowUpdate) {
                        ponderRowUpdate = copy(
                          ponderRowUpdate,
                          isCopyFast.get(table)!,
                        );
                        if (typeof userUpdateValues === "function") {
                          const userRowUpdate = copyOnWrite(ponderRowUpdate);
                          const userSet = userUpdateValues(userRowUpdate);
                          const ponderSet = copy(
                            userSet,
                            isCopyFast.get(table)!,
                          );
                          validateUpdateSet(
                            table,
                            ponderSet,
                            ponderRowUpdate,
                            primaryKeyCache,
                          );
                          normalizeUpdateSet(table, ponderSet);
                          for (const key in ponderSet) {
                            const value = ponderSet[key];
                            if (value === undefined) continue;
                            ponderRowUpdate[key] = value;
                          }
                        } else {
                          const userSet = userUpdateValues;
                          const ponderSet = copy(
                            userSet,
                            isCopyFast.get(table)!,
                          );
                          validateUpdateSet(
                            table,
                            ponderSet,
                            ponderRowUpdate,
                            primaryKeyCache,
                          );
                          normalizeUpdateSet(table, ponderSet);
                          for (const key in ponderSet) {
                            const value = ponderSet[key];
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

                      const ponderValues = copy(
                        userValues,
                        isCopyFast.get(table)!,
                      );

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
                // biome-ignore lint/suspicious/noThenProperty: The returned object is intentionally thenable for the query API.
                then: (onFulfilled, onRejected) =>
                  storeMethodWrapper(async () => {
                    metrics.incrementIndexingStoreQueries(
                      getTableName(table),
                      "insert",
                    );
                    checkOnchainTable(table, "insert");
                    const ponderValues = Array.isArray(userValues)
                      ? userValues.map((value) =>
                          copy(value, isCopyFast.get(table)!),
                        )
                      : copy(userValues, isCopyFast.get(table)!);

                    if (Array.isArray(ponderValues)) {
                      const ponderRows = [];
                      for (const value of ponderValues) {
                        checkTableAccess(table, "insert", value, chainId);

                        if (client.dialect === "pglite") {
                          const row = await get(table, value);

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
                      return userRows;
                    } else {
                      checkTableAccess(table, "insert", ponderValues, chainId);

                      let ponderRow: Row;
                      if (client.dialect === "pglite") {
                        const row = await get(table, ponderValues);

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
                      return userRow;
                    }
                  })().then(onFulfilled, onRejected),
                catch: (onRejected): Promise<any> =>
                  inner.then(undefined, onRejected),
                finally: (onFinally): Promise<any> =>
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
                // @ts-expect-error
              } satisfies ReturnType<
                ReturnType<IndexingStore["db"]["insert"]>["values"]
              >;

              return inner;
            },
          };
        },
        // @ts-expect-error
        update(table: Table, key) {
          return {
            set: storeMethodWrapper(async (userValues: any) => {
              metrics.incrementIndexingStoreQueries(
                getTableName(table),
                "update",
              );
              checkOnchainTable(table, "update");
              checkTableAccess(table, "update", key, chainId);

              let ponderRowUpdate = await get(table, key);

              if (ponderRowUpdate === null) {
                const error = new RecordNotFoundError(
                  `No existing record found in table '${getTableName(table)}'`,
                );
                error.meta.push(
                  `db.update arguments:\n${prettyPrint(key, { truncate: false })}`,
                );
                throw error;
              }

              ponderRowUpdate = copy(ponderRowUpdate, isCopyFast.get(table)!);

              if (typeof userValues === "function") {
                const userRow = copyOnWrite(ponderRowUpdate);
                const userSet = userValues(userRow);
                const ponderSet = copy(userSet, isCopyFast.get(table)!);
                validateUpdateSet(
                  table,
                  ponderSet,
                  ponderRowUpdate,
                  primaryKeyCache,
                );
                normalizeUpdateSet(table, ponderSet);
                for (const key in ponderSet) {
                  const value = ponderSet[key];
                  if (value === undefined) continue;
                  ponderRowUpdate[key] = value;
                }
              } else {
                const userSet = userValues;
                const ponderSet = copy(userSet, isCopyFast.get(table)!);
                validateUpdateSet(
                  table,
                  ponderSet,
                  ponderRowUpdate,
                  primaryKeyCache,
                );
                normalizeUpdateSet(table, ponderSet);
                for (const key in ponderSet) {
                  const value = ponderSet[key];
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
        delete: storeMethodWrapper(async (table: Table, key) => {
          metrics.incrementIndexingStoreQueries(getTableName(table), "delete");
          checkOnchainTable(table, "delete");
          checkTableAccess(table, "delete", key, chainId);
          return runPromise(indexingCache.delete({ table, key }));
        }),
        // @ts-expect-error
        sql: drizzle(
          storeMethodWrapper((sql, params, method, typings) =>
            runPromise(
              Effect.gen(function* () {
                // Note: The SQL parser loads WebAssembly the first time.
                const isSelectOnly = yield* externalIo(
                  Effect.promise(() => isReadonlySQLQuery(sql)),
                );

                if (isSelectOnly === false) {
                  yield* indexingCache.flush();
                  indexingCache.invalidate();
                  indexingCache.clear();
                } else {
                  // Note: Not all nodes are implemented in the parser,
                  // so the relations are undefined when parsing fails.
                  const relations = yield* externalIo(
                    Effect.tryPromise(() => getSQLQueryRelations(sql)),
                  ).pipe(Effect.orElseSucceed(() => undefined));

                  if (
                    Array.from(relations ?? []).some((refName) =>
                      views.some((view) => getViewName(view) === refName),
                    )
                  ) {
                    yield* indexingCache.flush();
                  } else {
                    yield* indexingCache.flush({ tableNames: relations });
                  }
                }

                const query: QueryWithTypings = { sql, params, typings };
                const endClock = yield* startClockEffect;

                // Note: Use transaction so that user-land queries don't affect the
                // in-progress transaction.
                return yield* client
                  .transaction((tx) =>
                    Effect.gen(function* () {
                      if (method === "all") {
                        // Note: Rows are arrays so that columns with the same
                        // name (e.g. from a join) don't overwrite each other.
                        const rows = yield* tx.query((tx) =>
                          tx._.session
                            .prepareQuery(
                              query,
                              undefined,
                              undefined,
                              true,
                              (rows) => rows,
                            )
                            .execute(),
                        );

                        return { rows };
                      }

                      return yield* tx.query((tx) =>
                        tx._.session
                          .prepareQuery(query, undefined, undefined, false)
                          .execute(),
                      );
                    }),
                  )
                  .pipe(
                    Effect.mapError((error) =>
                      error instanceof DbConnectionError
                        ? error
                        : new RawSqlError(error.message),
                    ),
                    Effect.ensuring(
                      Effect.map(endClock, (duration) =>
                        metrics.ponder_indexing_store_raw_sql_duration.observe(
                          duration,
                        ),
                      ),
                    ),
                  );
              }),
            ),
          ),
          { schema, casing: "snake_case" },
        ),
      },
      get client() {
        return client;
      },
      set client(_client: DbClient) {
        client = _client;
      },
      get isProcessingEvents() {
        return isProcessingEvents;
      },
      set isProcessingEvents(_isProcessingEvents: boolean) {
        isProcessingEvents = _isProcessingEvents;
      },
    };

    return indexingStore;
  });
