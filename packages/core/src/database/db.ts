import type { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzleNodePg } from "drizzle-orm/node-postgres";
import type { PgTransactionConfig } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { Context, Effect, Result, type Scope, type Stream } from "effect";
import type { Pool } from "pg";
import prometheus from "prom-client";
import {
  BaseError,
  BigIntSerializationError,
  CheckConstraintError,
  CopyFlushError,
  DbConnectionError,
  NonRetryableUserError,
  NotNullConstraintError,
  UniqueConstraintError,
} from "@/internal/errors.js";
import { makeLogUnsafe } from "@/internal/logger.js";
import { Metrics } from "@/internal/metrics.js";
import { Options } from "@/internal/options.js";
import type {
  NamespaceBuild,
  PreBuild,
  Schema,
  SchemaBuild,
} from "@/internal/types.js";
import * as PONDER_SYNC from "@/sync-store/schema.js";
import type { Drizzle } from "@/types/db.js";
import { createPool, createReadonlyPool } from "@/utils/pg.js";
import { createPglite } from "@/utils/pglite.js";
import { randomUUID } from "@/utils/random.js";
import { startClockEffect } from "@/utils/timer.js";
import {
  type DbListenTransport,
  type DbTransport,
  makeNodePostgresTransport,
  makePgliteTransport,
} from "./transport.js";

const RETRY_COUNT = 9;
const BASE_DURATION = 125;

export type QueryOptions = {
  /** Label for the logs and metrics of the query. */
  label?: string;
  /** Annotations for the logs of the query, such as `{ action: "migrate" }`. */
  logAnnotations?: Record<string, unknown>;
};

export type TransactionOptions = QueryOptions & {
  config?: PgTransactionConfig;
};

/**
 * Database client for one role, with retries, logging, metrics, and error
 * parsing.
 */
export type DbClient<TSchema extends Schema = Schema> = {
  dialect: DbTransport["dialect"];
  /** Drizzle database for building statements, such as subqueries. */
  drizzle: Drizzle<TSchema>;
  /**
   * Run the statement that `build` returns.
   *
   * @dev Retries, except in a transaction. A failed statement in a transaction
   * fails the transaction, which retries.
   */
  query<T>(
    build: (db: Drizzle<TSchema>) => T,
    options?: QueryOptions,
  ): Effect.Effect<Awaited<T>, Error>;
  /**
   * Run `transaction` in a transaction. Retries run `transaction` again from
   * the start.
   *
   * @dev On PGlite, `transaction` runs with the client itself, without a
   * transaction, and doesn't retry.
   */
  transaction<T, R>(
    transaction: (tx: DbClient<TSchema>) => Effect.Effect<T, Error, R>,
    options?: TransactionOptions,
  ): Effect.Effect<T, Error, R>;
  /**
   * Copy `text`, in the Postgres text format, into the table `target`.
   *
   * @dev Does not retry or log.
   */
  copy(target: string, text: string): Effect.Effect<void, CopyFlushError>;
};

/**
 * The database, with a client for each role.
 *
 * @dev On Postgres, each role has its own pool. On PGlite, the roles share one
 * instance.
 */
export class Db extends Context.Service<
  Db,
  {
    dialect: DbTransport["dialect"];
    /** Migrations, locks, and other internal statements. */
    admin: DbClient;
    /** The indexing store. */
    user: DbClient;
    /** User queries from the API server. */
    readonly: DbClient;
    /** The `ponder_sync` schema. */
    sync: DbClient<typeof PONDER_SYNC>;
    /**
     * Listen for notifications on `channel` with an admin connection, until
     * the scope closes.
     *
     * @returns The stream of the payloads of notifications, which fails when
     * the connection fails.
     */
    listen(
      channel: string,
    ): Effect.Effect<Stream.Stream<string, unknown>, unknown, Scope.Scope>;
  }
>()("ponder/Db") {}

export const parseDbError = (error: any): Error => {
  const stack = error.stack;

  if (error instanceof BaseError) {
    return error;
  }

  if (error?.message?.includes("violates not-null constraint")) {
    error = new NotNullConstraintError(error.message);
  } else if (error?.message?.includes("violates unique constraint")) {
    error = new UniqueConstraintError(error.message);
  } else if (error?.message?.includes("violates check constraint")) {
    error = new CheckConstraintError(error.message);
  } else if (
    // nodejs error message
    error?.message?.includes("Do not know how to serialize a BigInt") ||
    // bun error message
    error?.message?.includes("cannot serialize BigInt")
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
    error?.message?.includes(
      "Connection terminated due to connection timeout",
    ) ||
    error?.message?.includes("ECONNRESET") ||
    error?.message?.includes("ETIMEDOUT") ||
    error?.message?.includes("timeout exceeded when trying to connect")
  ) {
    error = new DbConnectionError(error.message);
  }

  error.stack = stack;

  return error;
};

/**
 * Create a client for one role on `transport`.
 */
export const makeDbClient = <
  TSchema extends Schema = { [name: string]: never },
>(
  transport: DbTransport<TSchema>,
  { metrics }: { metrics: Metrics["Service"] },
): DbClient<TSchema> => {
  const dialect = transport.dialect;

  // Retry, logging, metrics, and error parsing wrapper
  const retryLogMetricErrorWrap = <T, R>(
    effect: Effect.Effect<T, unknown, R>,
    {
      label,
      isTransaction,
      isTransactionStatement,
      logAnnotations,
    }: {
      label?: string;
      isTransaction: boolean;
      isTransactionStatement: boolean;
      logAnnotations: Record<string, unknown> | undefined;
    },
  ): Effect.Effect<T, Error, R> => {
    const log = (log: Effect.Effect<void>) =>
      logAnnotations ? Effect.annotateLogs(log, logAnnotations) : log;

    return Effect.gen(function* () {
      // First error thrown is often the most useful
      let firstError: Error | undefined;

      for (let i = 0; i <= RETRY_COUNT; i++) {
        const endClock = yield* startClockEffect;
        const id = (yield* randomUUID).slice(0, 8);

        if (label) {
          yield* log(
            Effect.logTrace({
              msg: "Started database query",
              query: label,
              query_id: id,
            }),
          );
        }

        const result = yield* Effect.result(effect);

        if (Result.isSuccess(result)) {
          if (label) {
            metrics.ponder_database_method_duration.observe(
              { method: label },
              yield* endClock,
            );

            yield* log(
              Effect.logTrace({
                msg: "Completed database query",
                query: label,
                query_id: id,
                duration: yield* endClock,
              }),
            );
          }

          return result.success;
        }

        const error = parseDbError(result.failure);

        if (label) {
          metrics.ponder_database_method_duration.observe(
            { method: label },
            yield* endClock,
          );
          metrics.ponder_database_method_error_total.inc({
            method: label,
          });
        }

        firstError ??= error;

        // Two types of transaction environments
        // 1. Inside callback (running user statements or control flow statements): Fail, retry
        // later. We want the error bubbled up out of the callback, so the transaction is properly rolled back.
        // 2. Outside callback (running entire transaction, user statements + control flow statements): Retry immediately.

        if (isTransaction) {
          if (error instanceof NonRetryableUserError) {
            return yield* Effect.fail(error);
          }
        } else if (isTransactionStatement) {
          // Transaction statements are not immediately retried, so the transaction will be properly rolled back.
          yield* log(
            Effect.logWarning({
              msg: "Failed database query",
              query: label,
              query_id: id,
              duration: yield* endClock,
              error,
            }),
          );
          return yield* Effect.fail(error);
        } else if (error instanceof NonRetryableUserError) {
          yield* log(
            Effect.logWarning({
              msg: "Failed database query",
              query: label,
              query_id: id,
              duration: yield* endClock,
              error,
            }),
          );
          return yield* Effect.fail(error);
        }

        if (i === RETRY_COUNT) {
          yield* log(
            Effect.logWarning({
              msg: "Failed database query",
              query: label,
              query_id: id,
              retry_count: i,
              duration: yield* endClock,
              error,
            }),
          );
          return yield* Effect.fail(firstError);
        }

        const duration = BASE_DURATION * 2 ** i;
        yield* log(
          Effect.logWarning({
            msg: "Failed database query",
            query: label,
            query_id: id,
            retry_count: i,
            retry_delay: duration,
            duration: yield* endClock,
            error,
          }),
        );
        yield* Effect.sleep(duration);
      }

      return yield* Effect.die("unreachable");
    });
  };

  const copy =
    (transport: DbTransport<TSchema>): DbClient<TSchema>["copy"] =>
    (target, text) =>
      transport
        .copy(target, text)
        .pipe(
          Effect.mapError(
            (error) => new CopyFlushError((error as Error).message),
          ),
        );

  // Note: We want to retry errors from `callback` but include
  // the transaction control statements in `transport.transaction`.
  const transaction =
    (transport: DbTransport<TSchema>): DbClient<TSchema>["transaction"] =>
    (callback, options) =>
      retryLogMetricErrorWrap(
        transport.transaction(
          (tx) => callback(createTransactionClient(tx, options)),
          options?.config,
        ),
        {
          label: options?.label,
          isTransaction: true,
          isTransactionStatement: false,
          logAnnotations: options?.logAnnotations,
        },
      );

  const createTransactionClient = (
    tx: DbTransport<TSchema>,
    transactionOptions: TransactionOptions | undefined,
  ): DbClient<TSchema> => ({
    dialect,
    drizzle: tx.db,
    // Note: `tx.query` should not retry errors, because the transaction will be aborted
    query: (build, options) =>
      retryLogMetricErrorWrap(tx.query(build), {
        label: options?.label ?? transactionOptions?.label,
        isTransaction: false,
        isTransactionStatement: true,
        logAnnotations:
          options?.logAnnotations ?? transactionOptions?.logAnnotations,
      }),
    transaction: transaction(tx),
    copy: copy(tx),
  });

  const client: DbClient<TSchema> = {
    dialect,
    drizzle: transport.db,
    query: (build, options) =>
      retryLogMetricErrorWrap(transport.query(build), {
        label: options?.label,
        isTransaction: false,
        isTransactionStatement: false,
        logAnnotations: options?.logAnnotations,
      }),
    transaction:
      dialect === "postgres"
        ? transaction(transport)
        : // Note: PGlite runs `callback` with the client itself, without a transaction.
          (callback, options) =>
            retryLogMetricErrorWrap(callback(client), {
              label: options?.label,
              isTransaction: false,
              isTransactionStatement: true,
              logAnnotations: undefined,
            }),
    copy: copy(transport),
  };

  return client;
};

type PGliteDriver = {
  dialect: "pglite";
  instance: PGlite;
};

type PostgresDriver = {
  dialect: "postgres";
  admin: Pool;
  sync: Pool;
  user: Pool;
  readonly: Pool;
};

/**
 * Create the drivers and a client for each role. The drivers close when the
 * scope closes.
 */
export const makeDb = ({
  namespace,
  preBuild,
  schemaBuild,
}: {
  namespace: NamespaceBuild;
  preBuild: Pick<PreBuild, "databaseConfig">;
  schemaBuild: Pick<SchemaBuild, "schema">;
}) =>
  Effect.gen(function* () {
    const options = yield* Options;
    const metrics = yield* Metrics;
    const logUnsafe = yield* makeLogUnsafe;

    let driver: PGliteDriver | PostgresDriver;
    let sync: DbClient<typeof PONDER_SYNC>;
    let admin: DbClient;
    let user: DbClient;
    let readonlyClient: DbClient;
    let adminTransport: DbListenTransport;

    const dialect = preBuild.databaseConfig.kind;

    if (dialect === "pglite" || dialect === "pglite_test") {
      const databaseConfig = preBuild.databaseConfig;
      const pgliteDriver: PGliteDriver = yield* Effect.acquireRelease(
        Effect.sync(() => ({
          dialect: "pglite" as const,
          instance:
            databaseConfig.kind === "pglite"
              ? createPglite(databaseConfig.options)
              : databaseConfig.instance,
        })),
        (driver) =>
          dialect === "pglite"
            ? Effect.promise(() => driver.instance.close())
            : Effect.void,
      );
      driver = pgliteDriver;
      adminTransport = makePgliteTransport(
        drizzlePglite(pgliteDriver.instance, { casing: "snake_case" }),
      );

      sync = makeDbClient(
        makePgliteTransport(
          drizzlePglite(pgliteDriver.instance, {
            casing: "snake_case",
            schema: PONDER_SYNC,
          }),
        ),
        { metrics },
      );
      admin = makeDbClient(
        makePgliteTransport(
          drizzlePglite(pgliteDriver.instance, {
            casing: "snake_case",
            schema: schemaBuild.schema,
          }),
        ),
        { metrics },
      );
      user = makeDbClient(
        makePgliteTransport(
          drizzlePglite(pgliteDriver.instance, {
            casing: "snake_case",
            schema: schemaBuild.schema,
          }),
        ),
        { metrics },
      );
      readonlyClient = makeDbClient(
        makePgliteTransport(
          drizzlePglite(pgliteDriver.instance, {
            casing: "snake_case",
            schema: schemaBuild.schema,
          }),
        ),
        { metrics },
      );
    } else {
      const internalMax = 2;
      const equalMax = Math.floor(
        (preBuild.databaseConfig.poolConfig.max - internalMax) / 3,
      );
      const [readonlyMax, userMax, syncMax] =
        options.command === "serve"
          ? [preBuild.databaseConfig.poolConfig.max - internalMax, 0, 0]
          : [equalMax, equalMax, equalMax];

      const poolConfig = preBuild.databaseConfig.poolConfig;

      const d: PostgresDriver = yield* Effect.acquireRelease(
        Effect.sync(() => ({
          dialect: "postgres" as const,
          admin: createPool(
            {
              ...poolConfig,
              application_name: `${namespace.schema}_internal`,
              max: internalMax,
              statement_timeout: 10 * 60 * 1000, // 10 minutes to accommodate slow sync store migrations.
            },
            logUnsafe,
          ),
          user: createPool(
            {
              ...poolConfig,
              application_name: `${namespace.schema}_user`,
              max: userMax,
            },
            logUnsafe,
          ),
          readonly: createReadonlyPool(
            {
              ...poolConfig,
              application_name: `${namespace.schema}_readonly`,
              max: readonlyMax,
            },
            logUnsafe,
            namespace.schema,
          ),
          sync: createPool(
            {
              ...poolConfig,
              application_name: "ponder_sync",
              max: syncMax,
            },
            logUnsafe,
          ),
        })),
        (d) =>
          Effect.promise(() =>
            Promise.all([
              d.admin.end(),
              d.user.end(),
              d.readonly.end(),
              d.sync.end(),
            ]),
          ),
      );
      driver = d;
      adminTransport = makeNodePostgresTransport(
        drizzleNodePg(d.admin, { casing: "snake_case" }),
      );

      sync = makeDbClient(
        makeNodePostgresTransport(
          drizzleNodePg(d.sync, {
            casing: "snake_case",
            schema: PONDER_SYNC,
          }),
        ),
        { metrics },
      );
      admin = makeDbClient(
        makeNodePostgresTransport(
          drizzleNodePg(d.admin, {
            casing: "snake_case",
            schema: schemaBuild.schema,
          }),
        ),
        { metrics },
      );
      user = makeDbClient(
        makeNodePostgresTransport(
          drizzleNodePg(d.user, {
            casing: "snake_case",
            schema: schemaBuild.schema,
          }),
        ),
        { metrics },
      );
      readonlyClient = makeDbClient(
        makeNodePostgresTransport(
          drizzleNodePg(d.readonly, {
            casing: "snake_case",
            schema: schemaBuild.schema,
          }),
        ),
        { metrics },
      );

      // Register Postgres-only metrics
      metrics.registry.removeSingleMetric("ponder_postgres_pool_connections");
      metrics.ponder_postgres_pool_connections = new prometheus.Gauge({
        name: "ponder_postgres_pool_connections",
        help: "Number of connections in the pool",
        labelNames: ["pool", "kind"] as const,
        registers: [metrics.registry],
        collect() {
          this.set({ pool: "admin", kind: "idle" }, d.admin.idleCount);
          this.set({ pool: "admin", kind: "total" }, d.admin.totalCount);
          this.set({ pool: "sync", kind: "idle" }, d.sync.idleCount);
          this.set({ pool: "sync", kind: "total" }, d.sync.totalCount);
          this.set({ pool: "user", kind: "idle" }, d.user.idleCount);
          this.set({ pool: "user", kind: "total" }, d.user.totalCount);
          this.set({ pool: "readonly", kind: "idle" }, d.readonly.idleCount);
          this.set({ pool: "readonly", kind: "total" }, d.readonly.totalCount);
        },
      });

      metrics.registry.removeSingleMetric("ponder_postgres_query_queue_size");
      metrics.ponder_postgres_query_queue_size = new prometheus.Gauge({
        name: "ponder_postgres_query_queue_size",
        help: "Number of queries waiting for an available connection",
        labelNames: ["pool"] as const,
        registers: [metrics.registry],
        collect() {
          this.set({ pool: "admin" }, d.admin.waitingCount);
          this.set({ pool: "sync" }, d.sync.waitingCount);
          this.set({ pool: "user" }, d.user.waitingCount);
          this.set({ pool: "readonly" }, d.readonly.waitingCount);
        },
      });
    }

    return Db.of({
      dialect: driver.dialect,
      admin,
      user,
      readonly: readonlyClient,
      sync,
      listen: (channel) => adminTransport.listen(channel),
    });
  });
