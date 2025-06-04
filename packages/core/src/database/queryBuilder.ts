import type { Common } from "@/internal/common.js";
import { NonRetryableError, ShutdownError } from "@/internal/errors.js";
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
import { Client, Pool, type PoolClient } from "pg";

const RETRY_COUNT = 9;
const BASE_DURATION = 125;
const SQL_LENGTH_LIMIT = 35;

type BaseQB<
  TSchema extends Schema = Schema,
  TClient extends PGlite | Pool | PoolClient = PGlite | Pool | PoolClient,
> = Omit<Drizzle<TSchema>, "transaction"> & {
  transaction<T>(
    transaction: (tx: QB<TSchema, TClient>) => Promise<T>,
    config?: PgTransactionConfig,
  ): Promise<T>;
} & (
    | { $dialect: "pglite"; $client: PGlite }
    | { $dialect: "postgres"; $client: Pool | PoolClient }
  );

/**
 * Query builder with built-in retry logic, logging, and metrics.
 */
export type QB<
  TSchema extends Schema = Schema,
  TClient extends PGlite | Pool | PoolClient = PGlite | Pool | PoolClient,
> = { label(label: string): BaseQB<TSchema, TClient> } & BaseQB<
  TSchema,
  TClient
>;

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
  TClient extends PGlite | Pool | PoolClient = PGlite | Pool | PoolClient,
>(
  common: Common,
  db: PgDatabase<PgQueryResultHKT, TSchema> & { $client: TClient },
  isAdmin = false,
): QB<TSchema, TClient> => {
  const dialect = new PgDialect({ casing: "snake_case" });
  let label: string | undefined;

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

        if (error instanceof NonRetryableError) {
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
      }
    }

    throw "unreachable";
  };

  const assignClient = (qb: QB<TSchema, TClient>, client: TClient) => {
    if (client instanceof Pool || client instanceof Client) {
      Object.assign(qb, { $dialect: "postgres" });
    } else {
      Object.assign(qb, { $dialect: "pglite" });
    }

    Object.assign(qb, { $client: client });
  };

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

  const _transaction = db.transaction.bind(db);
  db.transaction = async (...args) => {
    const callback = args[0];
    args[0] = (..._args) => {
      let qb = _args[0] as unknown as QB<TSchema, TClient>;

      qb.label = (_label: string) => {
        label = _label;
        return qb;
      };

      qb = new Proxy(qb, {
        get(target, prop) {
          if (prop !== "label") {
            label = undefined;
          }
          return Reflect.get(target, prop);
        },
      });

      // @ts-expect-error
      assignClient(qb, _args[0]._.session.client);
      return callback(..._args);
    };
    return _transaction(...args);
  };

  const transaction = db._.session.transaction.bind(db._.session);
  db._.session.transaction = async (...args) => {
    const callback = args[0];
    args[0] = async (..._args) => {
      const execute = _args[0]._.session.execute.bind(_args[0]._.session);
      // @ts-expect-error
      _args[0]._.session.execute = async (...args) => {
        return wrap(
          label,
          () =>
            execute(...args).catch((error) => {
              throw new NonRetryableError(error.message);
            }),
          dialect.sqlToQuery(args[0]).sql.slice(0, SQL_LENGTH_LIMIT),
        );
      };

      const prepareQuery = _args[0]._.session.prepareQuery.bind(
        _args[0]._.session,
      );
      // @ts-ignore
      _args[0]._.session.prepareQuery = (...args) => {
        const result = prepareQuery(...args);
        const execute = result.execute.bind(result);
        result.execute = async (..._args) => {
          return wrap(
            label,
            () =>
              execute(..._args).catch((error) => {
                throw new NonRetryableError(error.message);
              }),
            args[0].sql.slice(0, SQL_LENGTH_LIMIT),
          );
        };
        return result;
      };

      return callback(..._args);
    };

    return wrap(label, () => transaction(...args), "");
  };

  let qb = db as unknown as QB<TSchema, TClient>;

  qb.label = (_label: string) => {
    label = _label;
    return qb;
  };

  qb = new Proxy(qb, {
    get(target, prop) {
      if (prop !== "label") {
        label = undefined;
      }
      return Reflect.get(target, prop);
    },
  });

  assignClient(qb, db.$client);

  return qb;
};
