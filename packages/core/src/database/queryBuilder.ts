import type { Common } from "@/internal/common.js";
import {
  NonRetryableError,
  ShutdownError,
  TransactionError,
} from "@/internal/errors.js";
import {
  BigIntSerializationError,
  CheckConstraintError,
  NotNullConstraintError,
  UniqueConstraintError,
  getBaseError,
} from "@/internal/errors.js";
import type { Schema } from "@/internal/types.js";
import type { Drizzle } from "@/types/db.js";
import { startClock } from "@/utils/timer.js";
import { wait } from "@/utils/wait.js";
import type { PGlite } from "@electric-sql/pglite";
import {
  type PgDatabase,
  PgDialect,
  type PgQueryResultHKT,
  type PgTransactionConfig,
} from "drizzle-orm/pg-core";
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
> = ((label?: string) => Omit<Drizzle<TSchema>, "transaction"> & {
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

  return error;
};

/**
 * Create a query builder.
 *
 * @example
 * ```ts
 * const qb = createQB(common, drizzle(pool, { casing: "snake_case" }));
 * const result = await qb.label("test").select().from(accounts);
 * ```
 */
export const createQB = <
  TSchema extends Schema = { [name: string]: never },
  TClient extends PGlite | pg.Pool | pg.PoolClient =
    | PGlite
    | pg.Pool
    | pg.PoolClient,
>(
  createDb: () => PgDatabase<PgQueryResultHKT, TSchema> & { $client: TClient },
  { common, isAdmin }: { common: Common; isAdmin?: boolean },
): QB<TSchema, TClient> => {
  const dialect = new PgDialect({ casing: "snake_case" });
  let txLabel: string | undefined = undefined;

  const wrap = async <T>(
    label: string | undefined,
    fn: () => Promise<T>,
    sql: string,
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
            msg: `Failed '${label ?? sql}' database query (id=${id})`,
            error,
          });
          throw error;
        }

        if (i === RETRY_COUNT) {
          common.logger.warn({
            service: "database",
            msg: `Failed '${label ?? sql}' database query after '${i + 1}' attempts (id=${id})`,
            error,
          });
          throw firstError;
        }

        const duration = BASE_DURATION * 2 ** i;
        common.logger.debug({
          service: "database",
          msg: `Failed '${label ?? sql}' database query, retrying after ${duration} milliseconds (id=${id})`,
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

  const assignClient = (qb: QB<TSchema, TClient>, client: TClient) => {
    if (client instanceof pg.Pool || client instanceof pg.Client) {
      Object.assign(qb, { $dialect: "postgres" });
    } else {
      Object.assign(qb, { $dialect: "pglite" });
    }

    Object.assign(qb, { $client: client });
  };

  const wrapTx = (db: PgDatabase<PgQueryResultHKT, TSchema>) => {
    const _transaction = db.transaction.bind(db);
    db.transaction = async (...args) => {
      const callback = args[0];
      args[0] = async (_tx) => {
        wrapTx(_tx);

        const previousLabel = txLabel;

        const tx = (label?: string) => {
          txLabel = label;
          return _tx;
        };

        // @ts-expect-error
        assignClient(tx, _tx.session.client);
        // @ts-expect-error
        const result = await callback(tx);

        txLabel = previousLabel;
        return result;
      };
      return _transaction(...args);
    };
  };

  const qb = ((label: string | undefined) => {
    const db = createDb();
    const isClient = db.$client instanceof pg.Client;

    // non-transaction queries (retryable)

    const execute = db._.session.execute.bind(db._.session);
    db._.session.execute = async (...args) => {
      return wrap(
        label,
        () => execute(...args),
        dialect.sqlToQuery(args[0]).sql.slice(0, SQL_LENGTH_LIMIT),
      );
    };

    const prepareQuery = db._.session.prepareQuery.bind(db._.session);
    db._.session.prepareQuery = (...args) => {
      const result = prepareQuery(...args);
      const execute = result.execute.bind(result);
      result.execute = async (..._args) => {
        return wrap(
          label,
          () => execute(..._args),
          args[0].sql.slice(0, SQL_LENGTH_LIMIT),
        );
      };
      return result;
    };

    // transaction queries (non-retryable)

    wrapTx(db);
    txLabel = label;

    const transaction = db._.session.transaction.bind(db._.session);
    db._.session.transaction = async (...args) => {
      const callback = args[0];
      args[0] = async (..._args) => {
        const tx = _args[0] as PgDatabase<PgQueryResultHKT, TSchema>;
        const txExecute = isClient
          ? execute
          : tx._.session.execute.bind(tx._.session);
        // @ts-expect-error
        tx._.session.execute = async (...args) => {
          return wrap(
            txLabel,
            () =>
              txExecute(...args).catch((error) => {
                throw new TransactionError(error.message);
              }),
            dialect.sqlToQuery(args[0]).sql.slice(0, SQL_LENGTH_LIMIT),
          );
        };

        const txPrepareQuery = isClient
          ? prepareQuery
          : tx._.session.prepareQuery.bind(tx._.session);
        // @ts-ignore
        tx._.session.prepareQuery = (...args) => {
          const result = txPrepareQuery(...args);
          const execute = result.execute.bind(result);
          result.execute = async (..._args) => {
            return wrap(
              txLabel,
              () =>
                execute(..._args).catch((error) => {
                  throw new TransactionError(error.message);
                }),
              args[0].sql.slice(0, SQL_LENGTH_LIMIT),
            );
          };
          return result;
        };

        return callback(..._args);
      };

      return wrap(label, () => transaction(...args), "begin");
    };

    return db;
  }) as unknown as QB<TSchema, TClient>;

  assignClient(qb, createDb().$client);

  return qb;
};
