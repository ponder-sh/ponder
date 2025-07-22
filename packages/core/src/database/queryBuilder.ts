import type { Common } from "@/internal/common.js";
import {
  BigIntSerializationError,
  CheckConstraintError,
  NonRetryableError,
  NotNullConstraintError,
  ShutdownError,
  TransactionStatementError,
  UniqueConstraintError,
  getBaseError,
} from "@/internal/errors.js";
import type { Schema } from "@/internal/types.js";
import type { Drizzle } from "@/types/db.js";
import { startClock } from "@/utils/timer.js";
import { wait } from "@/utils/wait.js";
import { PGlite } from "@electric-sql/pglite";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type {
  PgDatabase,
  PgQueryResultHKT,
  PgTransaction,
  PgTransactionConfig,
} from "drizzle-orm/pg-core";
import type pg from "pg";

const RETRY_COUNT = 9;
const BASE_DURATION = 125;

/**
 * Query builder with built-in retry logic, logging, and metrics.
 */
export type QB<
  TSchema extends Schema = Schema,
  TClient extends PGlite | pg.Pool | pg.PoolClient =
    | PGlite
    | pg.Pool
    | pg.PoolClient,
> = (Omit<Drizzle<TSchema>, "transaction"> & {
  transaction<T>(
    transaction: (tx: QB<TSchema, TClient>) => Promise<T>,
    config?: PgTransactionConfig,
  ): Promise<T>;
  transaction<T>(
    { label }: { label: string },
    transaction: (tx: QB<TSchema, TClient>) => Promise<T>,
    config?: PgTransactionConfig,
  ): Promise<T>;
  wrap<T>(query: (db: Omit<QB<TSchema, TClient>, "wrap">) => T): T;
  wrap<T>(
    { label }: { label: string },
    query: (db: Omit<QB<TSchema, TClient>, "wrap">) => T,
  ): T;
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
 * const qb = createQB(drizzle(pool), { casing: "snake_case", common });
 * const result1 = await qb.select().from(accounts);
 * const result2 = await qb.wrap({ label: "label" }, (db) => db.select().from(accounts));
 * ```
 */
export const createQB = <TSchema extends Schema = { [name: string]: never }>(
  db: Drizzle<TSchema> & { $client: PGlite | pg.Pool | pg.PoolClient },
  { common, isAdmin }: { common: Common; isAdmin?: boolean },
): QB<TSchema, PGlite | pg.Pool | pg.PoolClient> => {
  const dialect = db.$client instanceof PGlite ? "pglite" : "postgres";

  const wrapTx = (db: PgDatabase<PgQueryResultHKT, TSchema>) => {
    const _transaction = db.transaction.bind(db);
    // @ts-ignore
    db.transaction = async (...args) => {
      if (typeof args[0] === "function") {
        const [callback, config] = args as [
          (
            tx: PgTransaction<
              PgQueryResultHKT,
              TSchema,
              ExtractTablesWithRelations<TSchema>
            >,
          ) => Promise<unknown>,
          PgTransactionConfig | undefined,
        ];

        // Note: We want to retry errors from `callback` but include
        // the transaction control statements in `_transaction`.

        // @ts-ignore
        return wrap(
          () =>
            _transaction((tx) => {
              wrapTx(tx);

              Object.assign(tx, { $dialect: dialect });
              // @ts-expect-error
              Object.assign(tx, { $client: tx.session.client });

              // Note: `tx.wrap` should not retry errors, because the transaction will be aborted
              // @ts-ignore
              (tx as unknown as QB<TSchema>).wrap = ({ label }, query) => {
                return wrap(
                  async () => {
                    try {
                      return await query(tx as unknown as QB<TSchema>);
                    } catch (error) {
                      if (error instanceof NonRetryableError) {
                        throw error;
                      }

                      throw new TransactionStatementError(
                        (error as Error).message,
                      );
                    }
                  },
                  {
                    label,
                    isTransactionCallback: true,
                    common,
                    isAdmin,
                  },
                );
              };

              return callback(tx).catch((error) => {
                if (error instanceof NonRetryableError) {
                  throw error;
                }

                throw new TransactionStatementError(error.message);
              });
            }, config),
          {
            isTransactionCallback: false,
            common,
            isAdmin,
          },
        );
      } else {
        const [{ label }, callback, config] = args as unknown as [
          { label: string },
          (
            tx: PgTransaction<
              PgQueryResultHKT,
              TSchema,
              ExtractTablesWithRelations<TSchema>
            >,
          ) => Promise<unknown>,
          PgTransactionConfig | undefined,
        ];

        // Note: We want to retry errors from `callback` but include
        // the transaction control statements in `_transaction`.

        // @ts-ignore
        return wrap(
          () =>
            _transaction((tx) => {
              wrapTx(tx);

              Object.assign(tx, { $dialect: dialect });
              // @ts-expect-error
              Object.assign(tx, { $client: tx.session.client });

              // Note: `tx.wrap` should not retry errors, because the transaction will be aborted
              // @ts-ignore
              (tx as unknown as QB<TSchema>).wrap = ({ label }, query) => {
                return wrap(
                  async () => {
                    try {
                      return await query(tx as unknown as QB<TSchema>);
                    } catch (error) {
                      if (error instanceof NonRetryableError) {
                        throw error;
                      }

                      throw new TransactionStatementError(
                        (error as Error).message,
                      );
                    }
                  },
                  {
                    label,
                    isTransactionCallback: true,
                    common,
                    isAdmin,
                  },
                );
              };

              return callback(tx).catch((error) => {
                if (error instanceof NonRetryableError) {
                  throw error;
                }

                throw new TransactionStatementError((error as Error).message);
              });
            }, config),
          { label, isTransactionCallback: false, common, isAdmin },
        );
      }
    };
  };

  wrapTx(db);

  const qb = db as unknown as QB<TSchema>;

  qb.$dialect = "postgres";
  qb.$client = db.$client;

  // @ts-ignore
  qb.wrap = (...args) => {
    if (typeof args[0] === "function") {
      const [query] = args;
      // @ts-ignore
      return wrap(() => query(qb), {
        isTransactionCallback: false,
        common,
        isAdmin,
      });
    } else {
      const [{ label }, query] = args;
      // @ts-ignore
      return wrap(() => query(qb), {
        isTransactionCallback: false,
        label,
        common,
        isAdmin,
      });
    }
  };

  return qb;
};

const wrap = async <T>(
  fn: () => Promise<T>,
  {
    common,
    isTransactionCallback,
    label,
    isAdmin,
  }: {
    common: Common;
    isTransactionCallback: boolean;
    label?: string;
    isAdmin?: boolean;
  },
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

      // Two types of transaction enviroments
      // 1. Inside callback (running user statements or control flow statements)
      // 2. Outside callback (running entire transaction, user statements + control flow statements)

      // Three transaction error cases to consider:
      // 1. `TransactionStatementError` + inside callback: Throw error, retry later. We want the error bubbled
      // up out of the callback, so the transaction is properly rolled back.
      // 2. `TransactionStatementError` + outside callback: Retry immediately.
      // 3. Not `TransactionStatementError`: Transaction control statements ("begin", "commit", "rollback", "savepoint", "release").
      // These are treated the same as non-transaction errors. They are retried immediately.

      if (
        error instanceof NonRetryableError ||
        (isTransactionCallback && error instanceof TransactionStatementError)
      ) {
        common.logger.warn({
          service: "database",
          msg: `Failed '${label}' database query (id=${id})`,
          error,
        });
        throw error;
      }

      if (i === RETRY_COUNT) {
        common.logger.warn({
          service: "database",
          msg: `Failed '${label}' database query after '${i + 1}' attempts (id=${id})`,
          error,
        });
        throw firstError;
      }

      const duration = BASE_DURATION * 2 ** i;
      common.logger.debug({
        service: "database",
        msg: `Failed '${label}' database query, retrying after ${duration} milliseconds (id=${id})`,
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
