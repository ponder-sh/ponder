import crypto from "node:crypto";
import type { Common } from "@/internal/common.js";
import {
  BaseError,
  TransactionCallbackError,
  TransactionControlError,
  TransactionStatementError,
} from "@/internal/errors.js";
import {
  BigIntSerializationError,
  CheckConstraintError,
  DbConnectionError,
  NonRetryableUserError,
  NotNullConstraintError,
  ShutdownError,
  UniqueConstraintError,
} from "@/internal/errors.js";
import type { Logger } from "@/internal/logger.js";
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
    context?: { logger?: Logger },
  ): Promise<T>;
  transaction<T>(
    { label }: { label: string },
    transaction: (tx: QB<TSchema, TClient>) => Promise<T>,
    config?: PgTransactionConfig,
    context?: { logger?: Logger },
  ): Promise<T>;
};

// TODO(kyle) handle malformed queries

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
  wrap<T>(
    query: (db: InnerQB<TSchema, TClient>) => T,
    context?: { logger?: Logger },
  ): T;
  wrap<T>(
    { label }: { label: string },
    query: (db: InnerQB<TSchema, TClient>) => T,
    context?: { logger?: Logger },
  ): T;
} & (
    | { $dialect: "pglite"; $client: PGlite }
    | { $dialect: "postgres"; $client: pg.Pool | pg.PoolClient }
  );

export const parseQBError = (error: Error): Error => {
  // TODO(kyle) how to know if the error is a query builder error?

  // TODO(kyle) do we need this?
  if (error instanceof BaseError) return error;

  if (error?.message?.includes("violates not-null constraint")) {
    return new NotNullConstraintError(undefined, { cause: error });
  } else if (error?.message?.includes("violates unique constraint")) {
    return new UniqueConstraintError(undefined, { cause: error });
  } else if (error?.message?.includes("violates check constraint")) {
    return new CheckConstraintError(undefined, { cause: error });
  } else if (
    // nodejs error message
    error?.message?.includes("Do not know how to serialize a BigInt") ||
    // bun error message
    error?.message?.includes("cannot serialize BigInt")
  ) {
    const bigIntSerializationError = new BigIntSerializationError(undefined, {
      cause: error,
    });
    bigIntSerializationError.meta.push(
      "Hint:\n  The JSON column type does not support BigInt values. Use the replaceBigInts() helper function before inserting into the database. Docs: https://ponder.sh/docs/api-reference/ponder-utils#replacebigints",
    );
    return bigIntSerializationError;
  } else if (error?.message?.includes("does not exist")) {
    return new NonRetryableUserError(error.message);
  } else if (error?.message?.includes("already exists")) {
    return new NonRetryableUserError(error.message);
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
    return new DbConnectionError(error.message);
  }

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
      logger,
    }: {
      label?: string;
      isTransaction: boolean;
      isTransactionStatement: boolean;
      logger: Logger;
    },
  ): Promise<T> => {
    // First error thrown is often the most useful
    let firstError: any;
    let hasError = false;

    for (let i = 0; i <= RETRY_COUNT; i++) {
      const endClock = startClock();
      const id = crypto.randomUUID().slice(0, 8);

      if (label) {
        logger.trace({
          msg: "Started database query",
          query: label,
          query_id: id,
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

        if (label) {
          logger.trace({
            msg: "Completed database query",
            query: label,
            query_id: id,
            duration: endClock(),
          });
        }

        return result;
      } catch (_error) {
        let error = parseQBError(_error as Error);

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

        // Three types of query environments
        // 1. Query outside of a transaction: Retry immediately.
        // 2. Query inside of a transaction: Throw error, retry later.
        // We want the error bubbled up out of the transaction callback scope, so the
        // so the control flow can rollback the transaction.
        // 3. Transaction callback: Retry immediately if the error was from #2 or from control statements, else throw error.

        if (isTransaction === false && isTransactionStatement) {
          logger.warn({
            msg: "Failed database query",
            query: label,
            query_id: id,
            duration: endClock(),
            error,
          });
          // Transaction statements are not immediately retried, so the transaction will be properly rolled back.
          throw new TransactionStatementError(undefined, { cause: error });
        } else if (error instanceof TransactionCallbackError) {
          throw error.cause;
        } else if (error instanceof NonRetryableUserError) {
          logger.warn({
            msg: "Failed database query",
            query: label,
            query_id: id,
            duration: endClock(),
            error,
          });
          throw error;
        }

        if (
          isTransaction &&
          error instanceof TransactionStatementError === false &&
          error instanceof TransactionCallbackError === false
        ) {
          error = new TransactionControlError(undefined, { cause: error });
        }

        if (i === RETRY_COUNT) {
          logger.warn({
            msg: "Failed database query",
            query: label,
            query_id: id,
            retry_count: i,
            duration: endClock(),
            error,
          });
          throw firstError;
        }

        const duration = BASE_DURATION * 2 ** i;
        logger.warn({
          msg: "Failed database query",
          query: label,
          query_id: id,
          retry_count: i,
          retry_delay: duration,
          duration: endClock(),
          error,
        });
        await wait(duration);
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
        const [callback, config, transactionContext] = args as unknown as [
          (
            tx: PgTransaction<
              PgQueryResultHKT,
              TSchema,
              ExtractTablesWithRelations<TSchema>
            >,
          ) => Promise<unknown>,
          PgTransactionConfig | undefined,
          { logger?: Logger } | undefined,
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
                  const [query, context] = args as [
                    (db: InnerQB<TSchema, TClient>) => unknown,
                    { logger?: Logger } | undefined,
                  ];
                  return retryLogMetricErrorWrap(
                    async () =>
                      query(tx as unknown as InnerQB<TSchema, TClient>),
                    {
                      isTransaction: false,
                      isTransactionStatement: true,
                      logger:
                        context?.logger ??
                        transactionContext?.logger ??
                        common.logger,
                    },
                  );
                } else {
                  const [{ label }, query, context] = args as [
                    { label: string },
                    (db: InnerQB<TSchema, TClient>) => unknown,
                    { logger?: Logger } | undefined,
                  ];
                  return retryLogMetricErrorWrap(
                    async () =>
                      query(tx as unknown as InnerQB<TSchema, TClient>),
                    {
                      label,
                      isTransaction: false,
                      isTransactionStatement: true,
                      logger:
                        context?.logger ??
                        transactionContext?.logger ??
                        common.logger,
                    },
                  );
                }
              };

              try {
                const result = await callback(tx);
                return result;
              } catch (error) {
                if (error instanceof TransactionStatementError) {
                  throw error;
                } else {
                  throw new TransactionCallbackError({ cause: error as Error });
                }
              }
            }, config),
          {
            isTransaction: true,
            isTransactionStatement: false,
            logger: transactionContext?.logger ?? common.logger,
          },
        );
      } else {
        const [{ label }, callback, config, transactionContext] =
          args as unknown as [
            { label: string },
            (
              tx: PgTransaction<
                PgQueryResultHKT,
                TSchema,
                ExtractTablesWithRelations<TSchema>
              >,
            ) => Promise<unknown>,
            PgTransactionConfig | undefined,
            { logger?: Logger } | undefined,
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
                  const [query, context] = args as [
                    (db: InnerQB<TSchema, TClient>) => unknown,
                    { logger?: Logger } | undefined,
                  ];
                  return retryLogMetricErrorWrap(
                    async () =>
                      query(tx as unknown as InnerQB<TSchema, TClient>),
                    {
                      label,
                      isTransaction: false,
                      isTransactionStatement: true,
                      logger:
                        context?.logger ??
                        transactionContext?.logger ??
                        common.logger,
                    },
                  );
                } else {
                  const [{ label }, query, context] = args as [
                    { label: string },
                    (db: InnerQB<TSchema, TClient>) => unknown,
                    { logger?: Logger } | undefined,
                  ];
                  return retryLogMetricErrorWrap(
                    async () =>
                      query(tx as unknown as InnerQB<TSchema, TClient>),
                    {
                      label,
                      isTransaction: false,
                      isTransactionStatement: true,
                      logger:
                        context?.logger ??
                        transactionContext?.logger ??
                        common.logger,
                    },
                  );
                }
              };

              try {
                const result = await callback(tx);
                return result;
              } catch (error) {
                if (error instanceof TransactionStatementError) {
                  throw error;
                } else {
                  throw new TransactionCallbackError({ cause: error as Error });
                }
              }
            }, config),
          {
            label,
            isTransaction: true,
            isTransactionStatement: false,
            logger: transactionContext?.logger ?? common.logger,
          },
        );
      }
    };
  };

  if (dialect === "postgres") {
    addQBMethods(db);
  } else {
    // @ts-ignore
    db.transaction = async (...args) => {
      if (typeof args[0] === "function") {
        const [callback, context] = args as [
          (
            tx: PgTransaction<
              PgQueryResultHKT,
              TSchema,
              ExtractTablesWithRelations<TSchema>
            >,
          ) => Promise<unknown>,
          { logger?: Logger } | undefined,
        ];

        return retryLogMetricErrorWrap(
          async () => {
            try {
              // @ts-expect-error
              const result = await callback(db);
              return result;
            } catch (error) {
              if (error instanceof TransactionStatementError) {
                throw error;
              } else {
                throw new TransactionCallbackError({ cause: error as Error });
              }
            }
          },
          {
            isTransaction: false,
            isTransactionStatement: true,
            logger: context?.logger ?? common.logger,
          },
        );
      } else {
        const [{ label }, callback, context] = args as [
          { label: string },
          (
            tx: PgTransaction<
              PgQueryResultHKT,
              TSchema,
              ExtractTablesWithRelations<TSchema>
            >,
          ) => Promise<unknown>,
          { logger?: Logger } | undefined,
        ];

        return retryLogMetricErrorWrap(
          async () => {
            try {
              // @ts-expect-error
              const result = await callback(db);
              return result;
            } catch (error) {
              if (error instanceof TransactionStatementError) {
                throw error;
              } else {
                throw new TransactionCallbackError({ cause: error as Error });
              }
            }
          },
          {
            label,
            isTransaction: false,
            isTransactionStatement: true,
            logger: context?.logger ?? common.logger,
          },
        );
      }
    };
  }

  const qb = db as unknown as QB<TSchema, TClient>;
  qb.raw = db;

  qb.$dialect = dialect;
  qb.$client = db.$client;

  qb.wrap = async (...args) => {
    if (typeof args[0] === "function") {
      const [query, context] = args;
      // @ts-expect-error
      return retryLogMetricErrorWrap(() => query(qb), {
        isTransactionStatement: false,
        // @ts-expect-error
        logger: context?.logger ?? common.logger,
      });
    } else {
      const [{ label }, query, context] = args;
      // @ts-expect-error
      return retryLogMetricErrorWrap(() => query(qb), {
        isTransactionStatement: false,
        label,
        // @ts-expect-error
        logger: context?.logger ?? common.logger,
      });
    }
  };

  return qb;
};
