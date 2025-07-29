import type { Common } from "@/internal/common.js";
import {
  BigIntSerializationError,
  CheckConstraintError,
  DbConnectionError,
  NonRetryableUserError,
  NotNullConstraintError,
  ShutdownError,
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

type InnerQB<
  TSchema extends Schema = Schema,
  TClient extends PGlite | pg.Pool | pg.PoolClient =
    | PGlite
    | pg.Pool
    | pg.PoolClient,
> = Omit<Drizzle<TSchema>, "transaction"> & TransactionQB<TSchema, TClient>;

type TransactionQB<
  TSchema extends Schema = Schema,
  TClient extends PGlite | pg.Pool | pg.PoolClient =
    | PGlite
    | pg.Pool
    | pg.PoolClient,
> = {
  /**
   * Transaction with retries, logging, metrics, and error parsing.
   */
  transaction<T>(
    transaction: (tx: QB<TSchema, TClient>) => Promise<T>,
    config?: PgTransactionConfig,
  ): Promise<T>;
  transaction<T>(
    { label }: { label: string },
    transaction: (tx: QB<TSchema, TClient>) => Promise<T>,
    config?: PgTransactionConfig,
  ): Promise<T>;
};

/**
 * Query builder with built-in retry logic, logging, and metrics.
 */
export type QB<
  TSchema extends Schema = Schema,
  TClient extends PGlite | pg.Pool | pg.PoolClient =
    | PGlite
    | pg.Pool
    | pg.PoolClient,
> = TransactionQB<TSchema, TClient> & {
  raw: Drizzle<TSchema>;
  /**
   * Query with retries, logging, metrics, and error parsing.
   */
  wrap<T>(query: (db: InnerQB<TSchema, TClient>) => T): T;
  wrap<T>(
    { label }: { label: string },
    query: (db: InnerQB<TSchema, TClient>) => T,
  ): T;
} & (
    | { $dialect: "pglite"; $client: PGlite }
    | { $dialect: "postgres"; $client: pg.Pool | pg.PoolClient }
  );

export const parseDbError = (e: any): Error => {
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
    error = new NonRetryableUserError(error.message);
  } else if (error?.message?.includes("already exists")) {
    error = new NonRetryableUserError(error.message);
  } else if (
    error?.message?.includes(
      "terminating connection due to administrator command",
    ) ||
    error?.message?.includes("connection to client lost") ||
    error?.message?.includes("too many clients already") ||
    error?.message?.includes("Connection terminated unexpectedly") ||
    error?.message?.includes("ECONNRESET") ||
    error?.message?.includes("ETIMEDOUT") ||
    error?.message?.includes("timeout exceeded when trying to connect")
  ) {
    error = new DbConnectionError(error.message);
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
 * const result1 = await qb.wrap((db) => db.select().from(accounts));
 * const result2 = await qb.wrap({ label: "label" }, (db) => db.select().from(accounts));
 * ```
 */
export const createQB = <
  TSchema extends Schema = { [name: string]: never },
  TClient extends PGlite | pg.Pool | pg.PoolClient =
    | PGlite
    | pg.Pool
    | pg.PoolClient,
>(
  db: Drizzle<TSchema> & { $client: TClient },
  { common, isAdmin }: { common: Common; isAdmin?: boolean },
): QB<TSchema, TClient> => {
  const dialect = db.$client instanceof PGlite ? "pglite" : "postgres";

  // Retry, logging, metrics, and error parsing wrapper
  const retryLogMetricErrorWrap = async <T>(
    fn: () => Promise<T>,
    {
      label,
      isTransaction,
      isTransactionStatement,
    }: {
      label?: string;
      isTransaction: boolean;
      isTransactionStatement: boolean;
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

        return result;
      } catch (e) {
        const error = parseDbError(e);

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
        // 1. Inside callback (running user statements or control flow statements): Throw error, retry
        // later. We want the error bubbled up out of the callback, so the transaction is properly rolled back.
        // 2. Outside callback (running entire transaction, user statements + control flow statements): Retry immediately.

        if (isTransaction) {
          if (error instanceof NonRetryableUserError) {
            throw error;
          }
        } else if (isTransactionStatement) {
          // Transaction statements are not immediately retried, so the transaction will be properly rolled back.
          common.logger.warn({
            service: "database",
            msg: `Failed ${label ? `'${label}' ` : ""}database query (id=${id})`,
            error,
          });
          throw error;
        } else if (error instanceof NonRetryableUserError) {
          common.logger.warn({
            service: "database",
            msg: `Failed ${label ? `'${label}' ` : ""}database query (id=${id})`,
            error,
          });
          throw error;
        }

        if (i === RETRY_COUNT) {
          common.logger.warn({
            service: "database",
            msg: `Failed ${label ? `'${label}' ` : ""}database query after '${i + 1}' attempts (id=${id})`,
            error,
          });
          throw firstError;
        }

        const duration = BASE_DURATION * 2 ** i;
        common.logger.debug({
          service: "database",
          msg: `Failed ${label ? `'${label}' ` : ""}database query, retrying after ${duration} milliseconds (id=${id})`,
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

  // Add QB methods to the transaction object
  const addQBMethods = (db: PgDatabase<PgQueryResultHKT, TSchema>) => {
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

        return retryLogMetricErrorWrap(
          () =>
            _transaction(async (tx) => {
              addQBMethods(tx);

              // @ts-expect-error
              tx.raw = tx;

              Object.assign(tx, { $dialect: dialect });
              // @ts-expect-error
              Object.assign(tx, { $client: tx.session.client });

              // Note: `tx.wrap` should not retry errors, because the transaction will be aborted
              // @ts-ignore
              (tx as unknown as QB<TSchema, TClient>).wrap = (...args) => {
                if (typeof args[0] === "function") {
                  const [query] = args;
                  return retryLogMetricErrorWrap(
                    async () =>
                      query(tx as unknown as InnerQB<TSchema, TClient>),
                    { isTransaction: false, isTransactionStatement: true },
                  );
                } else {
                  const [{ label }, query] = args as [
                    { label: string },
                    (db: InnerQB<TSchema, TClient>) => unknown,
                  ];
                  return retryLogMetricErrorWrap(
                    async () =>
                      query(tx as unknown as InnerQB<TSchema, TClient>),
                    {
                      label,
                      isTransaction: false,
                      isTransactionStatement: true,
                    },
                  );
                }
              };

              const result = await callback(tx);
              // @ts-ignore
              tx.wrap = undefined;
              // @ts-ignore
              tx.transaction = undefined;
              return result;
            }, config),
          { isTransaction: true, isTransactionStatement: false },
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

        return retryLogMetricErrorWrap(
          () =>
            _transaction(async (tx) => {
              addQBMethods(tx);

              // @ts-expect-error
              tx.raw = tx;

              Object.assign(tx, { $dialect: dialect });
              // @ts-expect-error
              Object.assign(tx, { $client: tx.session.client });

              // Note: `tx.wrap` should not retry errors, because the transaction will be aborted
              // @ts-ignore
              (tx as unknown as QB<TSchema, TClient>).wrap = (...args) => {
                if (typeof args[0] === "function") {
                  const [query] = args;
                  return retryLogMetricErrorWrap(
                    async () =>
                      query(tx as unknown as InnerQB<TSchema, TClient>),
                    {
                      label,
                      isTransaction: false,
                      isTransactionStatement: true,
                    },
                  );
                } else {
                  const [{ label }, query] = args as [
                    { label: string },
                    (db: InnerQB<TSchema, TClient>) => unknown,
                  ];
                  return retryLogMetricErrorWrap(
                    async () =>
                      query(tx as unknown as InnerQB<TSchema, TClient>),
                    {
                      label,
                      isTransaction: false,
                      isTransactionStatement: true,
                    },
                  );
                }
              };

              const result = await callback(tx);
              // @ts-ignore
              tx.wrap = undefined;
              // @ts-ignore
              tx.transaction = undefined;
              return result;
            }, config),
          { label, isTransaction: true, isTransactionStatement: false },
        );
      }
    };
  };

  addQBMethods(db);

  const qb = db as unknown as QB<TSchema, TClient>;
  qb.raw = db;

  qb.$dialect = "postgres";
  qb.$client = db.$client;

  // @ts-expect-error
  qb.wrap = async (...args) => {
    if (typeof args[0] === "function") {
      const [query] = args;
      // @ts-expect-error
      return retryLogMetricErrorWrap(async () => query(qb), {
        isTransactionStatement: false,
      });
    } else {
      const [{ label }, query] = args;
      // @ts-expect-error
      return retryLogMetricErrorWrap(() => query(qb), {
        isTransactionStatement: false,
        label,
      });
    }
  };

  return qb;
};
