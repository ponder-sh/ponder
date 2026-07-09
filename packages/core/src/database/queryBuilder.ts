import crypto from "node:crypto";
import type { Common } from "@/internal/common.js";
import { BaseError } from "@/internal/errors.js";
import {
  BigIntSerializationError,
  CheckConstraintError,
  DbConnectionError,
  NonRetryableUserError,
  NotNullConstraintError,
  ShutdownError,
  UniqueConstraintError,
  getErrorCauseByInstance,
  getErrorMessageWithCause,
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

const getErrorMessage = (error: unknown) => {
  if (typeof error === "object" && error !== null) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }

  return String(error);
};

const getErrorCode = (error: unknown) => {
  if (typeof error === "object" && error !== null) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }

  return undefined;
};

const getErrorCauseChain = (error: unknown) => {
  const errors: unknown[] = [];
  const seen = new Set<object>();
  let current = error;

  while (current !== undefined && current !== null) {
    errors.push(current);

    if (typeof current !== "object") break;
    if (seen.has(current)) break;
    seen.add(current);

    current = (current as { cause?: unknown }).cause;
  }

  return errors;
};

const isDrizzleQueryError = (error: unknown) => {
  return getErrorMessage(error).startsWith("Failed query:");
};

const getDbError = (error: unknown) => {
  const errors = getErrorCauseChain(error);

  return (
    errors.find((error) => getErrorCode(error) !== undefined) ??
    errors.find((error) => isDrizzleQueryError(error) === false) ??
    error
  );
};

export const parseDbError = (error: any): Error => {
  const stack = error.stack;
  const baseError = getErrorCauseByInstance(error, BaseError);
  if (baseError !== undefined) return baseError;

  const message = getErrorMessageWithCause(error);
  const dbError = getDbError(error);
  const dbCode = getErrorCode(dbError);
  const dbMessage = getErrorMessage(dbError);

  if (
    dbCode === "23502" ||
    dbMessage.includes("violates not-null constraint")
  ) {
    error = new NotNullConstraintError(message);
  } else if (
    dbCode === "23505" ||
    dbMessage.includes("violates unique constraint")
  ) {
    error = new UniqueConstraintError(message);
  } else if (
    dbCode === "23514" ||
    dbMessage.includes("violates check constraint")
  ) {
    error = new CheckConstraintError(message);
  } else if (
    // nodejs error message
    dbMessage.includes("Do not know how to serialize a BigInt") ||
    // bun error message
    dbMessage.includes("cannot serialize BigInt")
  ) {
    error = new BigIntSerializationError(message);
    error.meta.push(
      "Hint:\n  The JSON column type does not support BigInt values. Use the replaceBigInts() helper function before inserting into the database. Docs: https://ponder.sh/docs/api-reference/ponder-utils#replacebigints",
    );
  } else if (dbCode === "42P01" || dbMessage.includes("does not exist")) {
    error = new NonRetryableUserError(message);
  } else if (dbCode === "42710" || dbMessage.includes("already exists")) {
    error = new NonRetryableUserError(message);
  } else if (
    dbMessage.includes("terminating connection due to administrator command") ||
    dbMessage.includes("connection to client lost") ||
    dbMessage.includes("too many clients already") ||
    dbMessage.includes("Connection terminated unexpectedly") ||
    dbMessage.includes("ECONNRESET") ||
    dbMessage.includes("ETIMEDOUT") ||
    dbMessage.includes("timeout exceeded when trying to connect")
  ) {
    error = new DbConnectionError(message);
  }

  error.stack = stack;

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

        // Two types of transaction environments
        // 1. Inside callback (running user statements or control flow statements): Throw error, retry
        // later. We want the error bubbled up out of the callback, so the transaction is properly rolled back.
        // 2. Outside callback (running entire transaction, user statements + control flow statements): Retry immediately.

        if (isTransaction) {
          if (error instanceof NonRetryableUserError) {
            throw error;
          }
        } else if (isTransactionStatement) {
          // Transaction statements are not immediately retried, so the transaction will be properly rolled back.
          logger.warn({
            msg: "Failed database query",
            query: label,
            query_id: id,
            duration: endClock(),
            error,
          });
          throw error;
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

              const result = await callback(tx);
              return result;
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

              const result = await callback(tx);
              return result;
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

        // @ts-expect-error
        return retryLogMetricErrorWrap(() => callback(db), {
          isTransactionStatement: true,
          logger: context?.logger ?? common.logger,
        });
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

        // @ts-expect-error
        return retryLogMetricErrorWrap(() => callback(db), {
          label,
          isTransactionStatement: true,
          logger: context?.logger ?? common.logger,
        });
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
