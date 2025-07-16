import type { Common } from "@/internal/common.js";
import {
  BigIntSerializationError,
  CheckConstraintError,
  NonRetryableError,
  NotNullConstraintError,
  ShutdownError,
  TransactionError,
  UniqueConstraintError,
  getBaseError,
} from "@/internal/errors.js";
import type { Schema } from "@/internal/types.js";
import type { Drizzle } from "@/types/db.js";
import { startClock } from "@/utils/timer.js";
import { wait } from "@/utils/wait.js";
import type { PGlite } from "@electric-sql/pglite";
import type { DrizzleConfig } from "drizzle-orm";
import { drizzle as drizzleNodePg } from "drizzle-orm/node-postgres";
import {
  type PgDatabase,
  PgDialect,
  type PgQueryResultHKT,
  type PgTransactionConfig,
} from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import pg from "pg";

const RETRY_COUNT = 9;
const BASE_DURATION = 125;
const SQL_LENGTH_LIMIT = 50;

/**
 * Query builder with built-in retry logic, logging, and metrics.
 */
export type QB<
  TSchema extends Schema = Schema,
  TClient extends PGlite | pg.Pool | pg.PoolClient =
    | PGlite
    | pg.Pool
    | pg.PoolClient,
> = ((label: string) => Omit<Drizzle<TSchema>, "transaction"> & {
  transaction<T>(
    transaction: (tx: QB<TSchema, TClient>) => Promise<T>,
    config?: PgTransactionConfig,
  ): Promise<T>;
}) &
  (Omit<Drizzle<TSchema>, "transaction"> & {
    transaction<T>(
      transaction: (tx: QB<TSchema, TClient>) => Promise<T>,
      config?: PgTransactionConfig,
    ): Promise<T>;
  }) &
  (
    | { $dialect: "pglite"; $client: PGlite }
    | { $dialect: "postgres"; $client: pg.Pool | pg.PoolClient }
  );

export const parseSqlError = (e: any): Error => {
  let error = getBaseError(e);

  if (error?.message?.includes("violates not-null constraint")) {
    error = new NotNullConstraintError(error.message);
  } else if (error?.message?.includes("violates unique constraint")) {
    error = new UniqueConstraintError(error.message);
  } else if (error?.message?.includes("violates check constraint")) {
    error = new CheckConstraintError(error.message);
  } else if (
    error?.message?.includes("Do not know how to serialize a BigInt")
  ) {
    error = new BigIntSerializationError(error.message);
    error.meta.push(
      "Hint:\n  The JSON column type does not support BigInt values. Use the replaceBigInts() helper function before inserting into the database. Docs: https://ponder.sh/docs/api-reference/ponder-utils#replacebigints",
    );
  } else if (error?.message?.includes("does not exist")) {
    error = new NonRetryableError(error.message);
  }

  error.stack = e.stack;

  return error;
};

/**
 * Create a query builder.
 *
 * @example
 * ```ts
 * const qb = createQBNodePg(pool, { casing: "snake_case", common });
 * const result1 = await qb.select().from(accounts);
 * const result2 = await qb("label").select().from(accounts);
 * ```
 */
export const createQBNodePg = <
  TSchema extends Schema = { [name: string]: never },
>(
  client: pg.Pool | pg.PoolClient,
  params: DrizzleConfig<TSchema> & { common: Common; isAdmin?: boolean },
): QB<TSchema, pg.Pool | pg.PoolClient> => {
  const db = drizzleNodePg(client, params);

  const dialect = new PgDialect({ casing: "snake_case" });
  const isPool = client instanceof pg.Pool;

  const wrapTx = (db: PgDatabase<PgQueryResultHKT, TSchema>) => {
    const _transaction = db.transaction.bind(db);
    db.transaction = async (...args) => {
      const callback = args[0];
      args[0] = async (_tx) => {
        wrapTx(_tx);

        let tx = ((_label: string) => _tx) as unknown as QB<TSchema>;

        tx = new Proxy(tx, {
          get(_, prop) {
            return Reflect.get(_tx, prop);
          },
          set(_, prop, value) {
            return Reflect.set(_tx, prop, value);
          },
          has(_, prop) {
            return Reflect.has(_tx, prop);
          },
          ownKeys() {
            return Reflect.ownKeys(_tx);
          },
        });

        Object.assign(tx, { $dialect: "postgres" });
        // @ts-expect-error
        Object.assign(tx, { $client: _tx.session.client });

        // @ts-expect-error
        return callback(tx);
      };
      return _transaction(...args);
    };
  };

  // non-transaction queries (retryable)

  const execute = db._.session.execute.bind(db._.session);
  db._.session.execute = async (...args) => {
    return wrap(
      () => execute(...args),
      dialect.sqlToQuery(args[0]).sql,
      params,
    );
  };

  const prepareQuery = db._.session.prepareQuery.bind(db._.session);
  db._.session.prepareQuery = (...args) => {
    const result = prepareQuery(...args);
    const execute = result.execute.bind(result);
    result.execute = async (..._args) => {
      return wrap(() => execute(..._args), args[0].sql, params);
    };
    return result;
  };

  // transaction queries (non-retryable)

  const transaction = db._.session.transaction.bind(db._.session);
  db._.session.transaction = async (...args) => {
    const callback = args[0];
    args[0] = async (..._args) => {
      const tx = _args[0] as PgDatabase<PgQueryResultHKT, TSchema>;
      const txExecute = isPool
        ? tx._.session.execute.bind(tx._.session)
        : execute;
      // @ts-expect-error
      tx._.session.execute = async (...args) => {
        return wrap(
          () =>
            txExecute(...args).catch((error) => {
              throw new TransactionError(error.message);
            }),
          dialect.sqlToQuery(args[0]).sql,
          params,
        );
      };

      const txPrepareQuery = isPool
        ? tx._.session.prepareQuery.bind(tx._.session)
        : prepareQuery;
      // @ts-ignore
      tx._.session.prepareQuery = (...args) => {
        const result = txPrepareQuery(...args);
        const execute = result.execute.bind(result);
        result.execute = async (..._args) => {
          return wrap(
            () =>
              execute(..._args).catch((error) => {
                throw new TransactionError(error.message);
              }),
            args[0].sql,
            params,
          );
        };
        return result;
      };

      return callback(..._args);
    };

    return wrap(() => transaction(...args), "begin", params);
  };

  wrapTx(db);

  let qb = ((label: string) => {
    const db = drizzleNodePg(client, params);

    const execute = db._.session.execute.bind(db._.session);
    db._.session.execute = async (...args) => {
      return wrap(() => execute(...args), dialect.sqlToQuery(args[0]).sql, {
        ...params,
        label,
      });
    };

    const prepareQuery = db._.session.prepareQuery.bind(db._.session);
    db._.session.prepareQuery = (...args) => {
      const result = prepareQuery(...args);
      const execute = result.execute.bind(result);
      result.execute = async (..._args) => {
        return wrap(() => execute(..._args), args[0].sql, { ...params, label });
      };
      return result;
    };

    // transaction queries (non-retryable)

    const transaction = db._.session.transaction.bind(db._.session);
    db._.session.transaction = async (...args) => {
      const callback = args[0];
      args[0] = async (..._args) => {
        const tx = _args[0] as PgDatabase<PgQueryResultHKT, TSchema>;
        const txExecute = isPool
          ? tx._.session.execute.bind(tx._.session)
          : execute;
        // @ts-expect-error
        tx._.session.execute = async (...args) => {
          return wrap(
            () =>
              txExecute(...args).catch((error) => {
                throw new TransactionError(error.message);
              }),
            dialect.sqlToQuery(args[0]).sql,
            { ...params, label },
          );
        };

        const txPrepareQuery = isPool
          ? tx._.session.prepareQuery.bind(tx._.session)
          : prepareQuery;
        // @ts-ignore
        tx._.session.prepareQuery = (...args) => {
          const result = txPrepareQuery(...args);
          const execute = result.execute.bind(result);
          result.execute = async (..._args) => {
            return wrap(
              () =>
                execute(..._args).catch((error) => {
                  throw new TransactionError(error.message);
                }),
              args[0].sql,
              { ...params, label },
            );
          };
          return result;
        };

        return callback(..._args);
      };

      return wrap(() => transaction(...args), "begin", { ...params, label });
    };

    wrapTx(db);

    return db;
  }) as unknown as QB<TSchema>;

  qb = new Proxy(qb, {
    get(_, prop) {
      return Reflect.get(db, prop);
    },
    set(_, prop, value) {
      return Reflect.set(db, prop, value);
    },
    has(_, prop) {
      return Reflect.has(db, prop);
    },
    ownKeys() {
      return Reflect.ownKeys(db);
    },
  });

  Object.assign(qb, { $dialect: "postgres" });
  Object.assign(qb, { $client: client });

  return qb;
};

/**
 * Create a query builder.
 *
 * @example
 * ```ts
 * const qb = createQBPGlite(pglite, { casing: "snake_case", common });
 * const result1 = await qb.select().from(accounts);
 * const result2 = await qb("label").select().from(accounts);
 * ```
 */
export const createQBPGlite = <
  TSchema extends Schema = { [name: string]: never },
>(
  client: PGlite,
  params: DrizzleConfig<TSchema> & { common: Common; isAdmin?: boolean },
): QB<TSchema, pg.Pool | pg.PoolClient> => {
  const db = drizzlePglite(client, params);

  const dialect = new PgDialect({ casing: "snake_case" });

  const wrapTx = (db: PgDatabase<PgQueryResultHKT, TSchema>) => {
    const _transaction = db.transaction.bind(db);
    db.transaction = async (...args) => {
      const callback = args[0];
      args[0] = async (_tx) => {
        wrapTx(_tx);

        let tx = ((_label: string) => _tx) as unknown as QB<TSchema>;

        tx = new Proxy(tx, {
          get(_, prop) {
            return Reflect.get(_tx, prop);
          },
          set(_, prop, value) {
            return Reflect.set(_tx, prop, value);
          },
          has(_, prop) {
            return Reflect.has(_tx, prop);
          },
          ownKeys() {
            return Reflect.ownKeys(_tx);
          },
        });

        Object.assign(tx, { $dialect: "pglite" });
        // @ts-expect-error
        Object.assign(tx, { $client: _tx.session.client });

        // @ts-expect-error
        return callback(tx);
      };
      return _transaction(...args);
    };
  };

  // non-transaction queries (retryable)

  const execute = db._.session.execute.bind(db._.session);
  db._.session.execute = async (...args) => {
    return wrap(
      () => execute(...args),
      dialect.sqlToQuery(args[0]).sql,
      params,
    );
  };

  const prepareQuery = db._.session.prepareQuery.bind(db._.session);
  db._.session.prepareQuery = (...args) => {
    const result = prepareQuery(...args);
    const execute = result.execute.bind(result);
    result.execute = async (..._args) => {
      return wrap(() => execute(..._args), args[0].sql, params);
    };
    return result;
  };

  // transaction queries (non-retryable)

  const transaction = db._.session.transaction.bind(db._.session);
  db._.session.transaction = async (...args) => {
    const callback = args[0];
    args[0] = async (..._args) => {
      const tx = _args[0] as PgDatabase<PgQueryResultHKT, TSchema>;
      const execute = tx._.session.execute.bind(tx._.session);
      // @ts-expect-error
      tx._.session.execute = async (...args) => {
        return wrap(
          () =>
            execute(...args).catch((error) => {
              throw new TransactionError(error.message);
            }),
          dialect.sqlToQuery(args[0]).sql,
          params,
        );
      };

      const prepareQuery = tx._.session.prepareQuery.bind(tx._.session);
      // @ts-ignore
      tx._.session.prepareQuery = (...args) => {
        const result = prepareQuery(...args);
        // const execute = result.execute.bind(result);
        // result.execute = async (..._args) => {
        //   return wrap(
        //     () =>
        //       execute(..._args).catch((error) => {
        //         throw new TransactionError(error.message);
        //       }),
        //     args[0].sql,
        //     params,
        //   );
        // };
        return result;
      };

      return callback(..._args);
    };

    return wrap(() => transaction(...args), "begin", params);
  };

  wrapTx(db);

  let qb = ((label: string) => {
    const db = drizzlePglite(client, params);

    const execute = db._.session.execute.bind(db._.session);
    db._.session.execute = async (...args) => {
      return wrap(() => execute(...args), dialect.sqlToQuery(args[0]).sql, {
        ...params,
        label,
      });
    };

    const prepareQuery = db._.session.prepareQuery.bind(db._.session);
    db._.session.prepareQuery = (...args) => {
      const result = prepareQuery(...args);
      const execute = result.execute.bind(result);
      result.execute = async (..._args) => {
        return wrap(() => execute(..._args), args[0].sql, { ...params, label });
      };
      return result;
    };

    // transaction queries (non-retryable)

    const transaction = db._.session.transaction.bind(db._.session);
    db._.session.transaction = async (...args) => {
      const callback = args[0];
      args[0] = async (..._args) => {
        const tx = _args[0] as PgDatabase<PgQueryResultHKT, TSchema>;

        const execute = tx._.session.execute.bind(tx._.session);
        // @ts-expect-error
        tx._.session.execute = async (...args) => {
          return wrap(
            () =>
              execute(...args).catch((error) => {
                throw new TransactionError(error.message);
              }),
            dialect.sqlToQuery(args[0]).sql,
            { ...params, label },
          );
        };

        const prepareQuery = tx._.session.prepareQuery.bind(tx._.session);
        // @ts-ignore
        tx._.session.prepareQuery = (...args) => {
          const result = prepareQuery(...args);
          // const execute = result.execute.bind(result);
          // result.execute = async (..._args) => {
          //   return wrap(
          //     () =>
          //       execute(..._args).catch((error) => {
          //         throw new TransactionError(error.message);
          //       }),
          //     args[0].sql,
          //     { ...params, label },
          //   );
          // };
          return result;
        };

        return callback(..._args);
      };

      return wrap(() => transaction(...args), "begin", { ...params, label });
    };

    wrapTx(db);

    return db;
  }) as unknown as QB<TSchema>;

  qb = new Proxy(qb, {
    get(_, prop) {
      return Reflect.get(db, prop);
    },
    set(_, prop, value) {
      return Reflect.set(db, prop, value);
    },
    has(_, prop) {
      return Reflect.has(db, prop);
    },
    ownKeys() {
      return Reflect.ownKeys(db);
    },
  });

  Object.assign(qb, { $dialect: "pglite" });
  Object.assign(qb, { $client: client });

  return qb;
};

const wrap = async <T>(
  fn: () => Promise<T>,
  sql: string,
  {
    common,
    label,
    isAdmin,
  }: { common: Common; label?: string; isAdmin?: boolean },
): Promise<T> => {
  // First error thrown is often the most useful
  let firstError: any;
  let hasError = false;

  for (let i = 0; i <= RETRY_COUNT; i++) {
    const endClock = startClock();
    const id = crypto.randomUUID().slice(0, 8);

    if (label) {
      common.logger.trace({
        service: "database",
        msg: `Started '${label}' database method (id=${id})`,
      });
    }

    try {
      if (common.shutdown.isKilled && isAdmin === false) {
        throw new ShutdownError();
      }

      const result = await fn();
      if (label) {
        common.metrics.ponder_database_method_duration.observe(
          { method: label },
          endClock(),
        );
      }

      if (common.shutdown.isKilled && isAdmin === false) {
        throw new ShutdownError();
      }

      return result;
    } catch (e) {
      const error = parseSqlError(e);

      if (common.shutdown.isKilled) {
        throw new ShutdownError();
      }

      if (label) {
        common.metrics.ponder_database_method_duration.observe(
          { method: label },
          endClock(),
        );
        common.metrics.ponder_database_method_error_total.inc({
          method: label,
        });
      }

      if (!hasError) {
        hasError = true;
        firstError = error;
      }

      if (
        error instanceof NonRetryableError &&
        error instanceof TransactionError === false
      ) {
        common.logger.warn({
          service: "database",
          msg: `Failed '${sql.slice(0, SQL_LENGTH_LIMIT)}...' database query (id=${id})`,
          error,
        });
        throw error;
      }

      if (i === RETRY_COUNT) {
        common.logger.warn({
          service: "database",
          msg: `Failed '${sql.slice(0, SQL_LENGTH_LIMIT)}...' database query after '${i + 1}' attempts (id=${id})`,
          error,
        });
        throw firstError;
      }

      const duration = BASE_DURATION * 2 ** i;
      common.logger.debug({
        service: "database",
        msg: `Failed '${sql.slice(0, SQL_LENGTH_LIMIT)}...' database query, retrying after ${duration} milliseconds (id=${id})`,
        error,
      });
      await wait(duration);
    } finally {
      if (label) {
        common.logger.trace({
          service: "database",
          msg: `Completed '${label}' database method in ${Math.round(endClock())}ms (id=${id})`,
        });
      }
    }
  }

  throw "unreachable";
};
