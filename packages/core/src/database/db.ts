import type { Column, SQLWrapper } from "drizzle-orm";
import * as drizzleOrm from "drizzle-orm";
import { toSnakeCase } from "drizzle-orm/casing";
import { PgDialect } from "drizzle-orm/pg-core";
import { drizzle as drizzleProxy } from "drizzle-orm/pg-proxy";
import {
  Context,
  Effect,
  Exit,
  Result,
  Scope,
  Semaphore,
  type Stream,
} from "effect";
import prometheus from "prom-client";
import {
  BaseError,
  BigIntSerializationError,
  CheckConstraintError,
  DbConnectionError,
  NonRetryableUserError,
  NotNullConstraintError,
  UniqueConstraintError,
} from "../internal/errors.js";
import { externalIo } from "../internal/io.js";
import { makeLogUnsafe } from "../internal/logger.js";
import { Metrics } from "../internal/metrics.js";
import { Options } from "../internal/options.js";
import type { NamespaceBuild, PreBuild, Schema } from "../internal/types.js";
import { createPool, createReadonlyPool } from "../utils/pg.js";
import { createPglite } from "../utils/pglite.js";
import { randomUUID } from "../utils/random.js";
import { startClockEffect } from "../utils/timer.js";
import {
  type CompiledStatement,
  DbError,
  type DbListenTransport,
  type DbTransport,
  type DbTransportTransaction,
  makeNodePostgresTransport,
  makePgliteTransport,
} from "./transport.js";
import { makeBunPostgresTransport } from "./transport-bun.js";

const RETRY_COUNT = 9;
const BASE_DURATION = 125;

/** Postgres's limit of bind parameters in one statement. */
export const MAX_QUERY_PARAMS = 65_535;

const casingPerColumn = new WeakMap<Column, string>();

/**
 * Use the snake case name of each column object. drizzle caches the names of
 * a table by its name, so a table that a reload changed would get stale names.
 */
const withColumnCasing = <T>(dialect: T): T => {
  (
    dialect as unknown as {
      casing: { getColumnCasing: (column: Column) => string };
    }
  ).casing.getColumnCasing = (column) => {
    if (column.keyAsName === false) return column.name;
    let name = casingPerColumn.get(column);
    if (name === undefined) {
      name = toSnakeCase(column.name);
      casingPerColumn.set(column, name);
    }
    return name;
  };
  return dialect;
};

const dialect = withColumnCasing(new PgDialect({ casing: "snake_case" }));

/** Builds statements for `db.run`, with the relational queries of `schema`. It cannot run them. */
export const makeBuilder = <TSchema extends Schema>(schema?: TSchema) => {
  const db = drizzleProxy<TSchema>(
    () => {
      throw new Error("Statements from `builder` run with `db.run`");
    },
    { casing: "snake_case", schema },
  );
  withColumnCasing((db as unknown as { dialect: unknown }).dialect);
  return db;
};

/** Builds statements for `db.run`. It cannot run them. */
export const builder = makeBuilder();

// Note: drizzle decodes rows with this, but doesn't type it.
const { mapResultRow } = drizzleOrm as unknown as {
  mapResultRow: (
    fields: unknown,
    row: unknown[],
    joinsNotNullableMap: Record<string, boolean> | undefined,
  ) => unknown;
};

type Prepared = {
  queryString: string;
  params: unknown[];
  fields?: unknown;
  joinsNotNullableMap?: Record<string, boolean>;
  customResultMapper?: (rows: unknown[][]) => unknown;
  typings?: string[];
};

/**
 * Fix the SQL and parameters of `statement` now, so that a retry sends the
 * same statement.
 */
export const compile = (statement: SQLWrapper): CompiledStatement => {
  // Note: The prepared query has the fields that drizzle decodes rows with.
  // Note: `db.execute` returns a statement whose `_prepare` returns itself.
  const _prepared = (statement as { _prepare?: () => Prepared })._prepare?.();
  const prepared = _prepared?.queryString === undefined ? undefined : _prepared;
  const { sql, params, typings } = prepared
    ? {
        sql: prepared.queryString,
        params: prepared.params,
        typings: prepared.typings,
      }
    : dialect.sqlToQuery(statement.getSQL());

  if (params.length > MAX_QUERY_PARAMS) {
    throw new Error(
      `Statement has ${params.length} parameters, more than the limit of ${MAX_QUERY_PARAMS}: ${sql.slice(0, 120)}`,
    );
  }

  if (prepared?.customResultMapper !== undefined) {
    const map = prepared.customResultMapper;
    return {
      sql,
      params,
      typings,
      arrayMode: true,
      decode: (rows) => map(rows as unknown[][]),
    };
  }
  if (prepared?.fields !== undefined) {
    const { fields, joinsNotNullableMap } = prepared;
    return {
      sql,
      params,
      typings,
      arrayMode: true,
      decode: (rows) =>
        rows.map((row) =>
          mapResultRow(fields, row as unknown[], joinsNotNullableMap),
        ),
    };
  }
  return { sql, params, typings };
};

/** A statement that copies `text`, in the Postgres text format, into `target`. */
export const copyFrom = (target: string, text: string): CompiledStatement => ({
  sql: `COPY ${target} FROM STDIN`,
  params: [],
  copy: text,
});

/** A raw SQL statement without parameters. */
export const rawSql = (sql: string): CompiledStatement => ({ sql, params: [] });

/**
 * Split `rows` into batches whose statements stay under {@link MAX_QUERY_PARAMS},
 * with `paramsPerRow` parameters for each row and `extraParams` for each statement.
 */
export const chunkRows = <T>(
  rows: readonly T[],
  paramsPerRow: number,
  extraParams = 0,
): T[][] => {
  const size = Math.max(
    1,
    Math.floor((MAX_QUERY_PARAMS - extraParams) / Math.max(paramsPerRow, 1)),
  );
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    chunks.push(rows.slice(i, i + size));
  }
  return chunks;
};

export type Statement = SQLWrapper | CompiledStatement;

type StatementResult<statement> = statement extends CompiledStatement
  ? unknown[]
  : statement extends PromiseLike<infer result>
    ? result
    : unknown[];

export type RunOptions = {
  /** Label for the logs and metrics of the statements. */
  label?: string;
  /** Annotations for the logs, such as `{ action: "migrate" }`. */
  logAnnotations?: Record<string, unknown>;
  /** In a transaction, a failure rolls back only these statements. */
  savepoint?: boolean;
};

export type Run = {
  <const statement extends Statement>(
    statement: statement,
    options?: RunOptions,
  ): Effect.Effect<StatementResult<statement>, Error>;
  <const statements extends readonly Statement[]>(
    statements: statements,
    options?: RunOptions,
  ): Effect.Effect<
    { -readonly [K in keyof statements]: StatementResult<statements[K]> },
    Error
  >;
};

/** Runs statements, either on its own or in a transaction. */
export type DbRunner = {
  dialect: DbTransport["dialect"];
  /**
   * Run one statement, or a list in one transaction, in order. The statements
   * are compiled when `run` is called, so a retry sends the same ones.
   */
  run: Run;
};

/**
 * Database client for one role, with retries, logging, metrics, and error
 * parsing.
 */
export type DbClient = DbRunner & {
  /**
   * Open a transaction, which rolls back when the scope closes before `commit`.
   *
   * @dev A failure that rolled back the transaction, such as a lost
   * connection, opens a new one and runs the statements that succeeded again.
   * The work between statements never runs again. On PGlite, each `run` is
   * its own transaction.
   */
  begin: Effect.Effect<DbTransaction, Error, Scope.Scope>;
};

export type DbTransaction = DbRunner & {
  commit: Effect.Effect<void, Error>;
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
    sync: DbClient;
    /**
     * Listen for notifications on `channel` with an admin connection, until
     * the scope closes.
     *
     * @returns The stream of the payloads of notifications, which fails when
     * the connection fails.
     */
    listen(
      channel: string,
    ): Effect.Effect<Stream.Stream<string, Error>, Error, Scope.Scope>;
  }
>()("ponder/Db") {}

export const parseDbError = (error: any): Error => {
  if (error instanceof DbError) error = error.cause;
  const stack = error?.stack;

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
  } else if (error instanceof Error === false) {
    error = new Error(String(error));
  }

  error.stack = stack;

  return error;
};

/**
 * Classes of SQLSTATE codes for failures that can succeed again: connection,
 * transaction rollback, resources, operator intervention, and system errors.
 */
const TRANSIENT_CLASSES = ["08", "40", "53", "57", "58"];

/** `true` if `error` is known to have not applied, and running it again can succeed. */
const isRetryable = (error: DbError) => {
  if (error.notApplied === false) return false;
  if (parseDbError(error) instanceof NonRetryableUserError) return false;
  const cause = error.cause as { code?: unknown; errno?: unknown } | undefined;
  const code = [cause?.code, cause?.errno].find(
    (code): code is string =>
      typeof code === "string" && /^[0-9A-Z]{5}$/.test(code),
  );
  // Note: An error without a SQLSTATE comes from the driver, such as a lost connection.
  if (code === undefined) return true;
  return TRANSIENT_CLASSES.includes(code.slice(0, 2)) || code === "55P03";
};

const toList = (statements: Statement | readonly Statement[]) =>
  (Array.isArray(statements) ? statements : [statements]).map((statement) =>
    "getSQL" in statement
      ? compile(statement)
      : (statement as CompiledStatement),
  );

const decode = (
  compiled: readonly CompiledStatement[],
  results: unknown[][],
  isList: boolean,
) => {
  const decoded = results.map((rows, i) =>
    compiled[i]!.decode ? compiled[i]!.decode!(rows) : rows,
  );
  return isList ? decoded : decoded[0];
};

/**
 * Create a client for one role on `transport`.
 */
export const makeDbClient = (
  transport: DbTransport,
  { metrics }: { metrics: Metrics["Service"] },
): DbClient => {
  const dialect = transport.dialect;

  /**
   * Run `attempt` until it succeeds, fails with an error that can't succeed
   * again, or fails {@link RETRY_COUNT} times.
   */
  const retry = <T>(
    attempt: Effect.Effect<T, DbError>,
    { label, logAnnotations }: RunOptions,
  ): Effect.Effect<T, Error> => {
    const log = (log: Effect.Effect<void>) =>
      logAnnotations ? Effect.annotateLogs(log, logAnnotations) : log;

    return Effect.gen(function* () {
      // Note: The first error is often the most useful.
      let firstError: Error | undefined;

      for (let i = 0; ; i++) {
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

        const result = yield* Effect.result(attempt);

        if (label) {
          metrics.ponder_database_method_duration.observe(
            { method: label },
            yield* endClock,
          );
        }

        if (Result.isSuccess(result)) {
          if (label) {
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

        if (label) {
          metrics.ponder_database_method_error_total.inc({ method: label });
        }

        const error = parseDbError(result.failure);
        firstError ??= error;

        if (isRetryable(result.failure) === false || i === RETRY_COUNT) {
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
          return yield* Effect.fail(i === RETRY_COUNT ? firstError : error);
        }

        const delay = BASE_DURATION * 2 ** i;
        yield* log(
          Effect.logWarning({
            msg: "Failed database query",
            query: label,
            query_id: id,
            retry_count: i,
            retry_delay: delay,
            duration: yield* endClock,
            error,
          }),
        );
        yield* Effect.sleep(delay);
      }
    });
  };

  const run = ((
    statements: Statement | readonly Statement[],
    options: RunOptions = {},
  ) =>
    Effect.suspend(() => {
      const isList = Array.isArray(statements);
      const compiled = toList(statements);
      if (compiled.length === 0) return Effect.succeed([]);
      return retry(transport.run(compiled), options).pipe(
        Effect.map((results) => decode(compiled, results, isList)),
      );
    })) as Run;

  const begin: DbClient["begin"] = Effect.gen(function* () {
    const outer = yield* Scope.Scope;
    const lock = yield* Semaphore.make(1);
    /** The statements that succeeded, which a new transaction runs again. */
    const log: { statements: CompiledStatement[]; savepoint: boolean }[] = [];
    let current: { scope: Scope.Closeable; tx?: DbTransportTransaction };
    let isOpen = false;
    let isCommitted = false;

    // Note: The scope of the previous transaction closes even when it failed
    // to open, so that its connection returns to the pool.
    const open = Effect.gen(function* () {
      isOpen = false;
      if (current !== undefined) yield* Scope.close(current.scope, Exit.void);
      current = { scope: yield* Scope.fork(outer) };
      const tx = yield* transport.begin.pipe(Scope.provide(current.scope));
      current.tx = tx;
      for (const { statements, savepoint } of log) {
        yield* tx.run(statements, savepoint);
      }
      isOpen = true;
    });

    /** Run `f` in the open transaction, after opening a new one if it rolled back. */
    const inTransaction = <T>(
      f: (tx: DbTransportTransaction) => Effect.Effect<T, DbError>,
    ) =>
      Effect.suspend(() =>
        isOpen ? f(current.tx!) : Effect.andThen(open, () => f(current.tx!)),
      ).pipe(
        Effect.tapError((error) =>
          Effect.sync(() => {
            if (error.aborted) isOpen = false;
          }),
        ),
      );

    yield* retry(open, { label: "begin" });

    const runInTransaction = ((
      statements: Statement | readonly Statement[],
      options: RunOptions = {},
    ) =>
      lock.withPermit(
        Effect.suspend(() => {
          if (isCommitted) {
            return Effect.die(new Error("The transaction already committed"));
          }
          const isList = Array.isArray(statements);
          const compiled = toList(statements);
          if (compiled.length === 0) return Effect.succeed([]);
          const savepoint = options.savepoint === true;
          return retry(
            inTransaction((tx) => tx.run(compiled, savepoint)),
            options,
          ).pipe(
            Effect.tap(() =>
              Effect.sync(() => log.push({ statements: compiled, savepoint })),
            ),
            Effect.map((results) => decode(compiled, results, isList)),
          );
        }),
      )) as Run;

    return {
      dialect,
      run: runInTransaction,
      commit: lock.withPermit(
        retry(
          inTransaction((tx) => tx.commit),
          { label: "commit" },
        ).pipe(Effect.tap(() => Effect.sync(() => (isCommitted = true)))),
      ),
    } satisfies DbTransaction;
  });

  return { dialect, run, begin };
};

/**
 * The transport of each role of the database.
 *
 * @dev The transports of {@link makeDbTransports} use the drivers of the
 * config. A simulation can wrap them, or replace them.
 */
export type DbTransports = {
  dialect: DbTransport["dialect"];
  admin: DbListenTransport;
  user: DbTransport;
  readonly: DbTransport;
  sync: DbTransport;
};

/**
 * Create the drivers of the database config, and a transport for each role.
 * The drivers close when the scope closes.
 */
export const makeDbTransports = ({
  namespace,
  preBuild,
}: {
  namespace: NamespaceBuild;
  preBuild: Pick<PreBuild, "databaseConfig">;
}): Effect.Effect<DbTransports, never, Options | Metrics | Scope.Scope> =>
  Effect.gen(function* () {
    const options = yield* Options;
    const metrics = yield* Metrics;
    const logUnsafe = yield* makeLogUnsafe;

    if (preBuild.databaseConfig.kind === "pglite") {
      const databaseConfig = preBuild.databaseConfig;
      const instance = yield* Effect.acquireRelease(
        Effect.sync(() => createPglite(databaseConfig.options)),
        (instance) => Effect.promise(() => instance.close()),
      );
      const transport = makePgliteTransport(instance);

      return {
        dialect: "pglite",
        admin: transport,
        user: transport,
        readonly: transport,
        sync: transport,
      };
    }

    const internalMax = 2;
    const equalMax = Math.floor(
      (preBuild.databaseConfig.poolConfig.max - internalMax) / 3,
    );
    const [readonlyMax, userMax, syncMax] =
      options.command === "serve"
        ? [preBuild.databaseConfig.poolConfig.max - internalMax, 0, 0]
        : [equalMax, equalMax, equalMax];

    const poolConfig = preBuild.databaseConfig.poolConfig;

    if (preBuild.databaseConfig.driver === "bun") {
      const { SQL } = yield* Effect.promise(() => import("bun"));
      const options = {
        url: poolConfig.connectionString,
        hostname: poolConfig.host,
        port: poolConfig.port,
        username: poolConfig.user,
        password: poolConfig.password as string | undefined,
        database: poolConfig.database,
        tls: poolConfig.ssl,
      };
      const writer = {
        synchronous_commit: "off",
        idle_in_transaction_session_timeout: "3600000",
      };
      const transport = (max: number, settings: Record<string, string>) =>
        makeBunPostgresTransport(SQL, {
          options: { ...options, max } as Parameters<
            typeof makeBunPostgresTransport
          >[1]["options"],
          settings,
        });

      return {
        dialect: "postgres",
        admin: yield* transport(internalMax, {
          ...writer,
          application_name: `${namespace.schema}_internal`,
          // 10 minutes to accommodate slow sync store migrations.
          statement_timeout: String(10 * 60 * 1000),
        }),
        user: yield* transport(userMax, {
          ...writer,
          application_name: `${namespace.schema}_user`,
          statement_timeout: String(2 * 60 * 1000),
        }),
        readonly: yield* transport(readonlyMax, {
          application_name: `${namespace.schema}_readonly`,
          search_path: `"${namespace.schema}"`,
          default_transaction_read_only: "on",
          work_mem: "512MB",
          lock_timeout: "500ms",
          statement_timeout: String(30 * 1000),
        }),
        sync: yield* transport(syncMax, {
          ...writer,
          application_name: "ponder_sync",
          statement_timeout: String(2 * 60 * 1000),
        }),
      };
    }

    const pools = yield* Effect.acquireRelease(
      Effect.sync(() => ({
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
      (pools) =>
        externalIo(
          Effect.promise(() =>
            Promise.all(Object.values(pools).map((pool) => pool.end())),
          ),
        ),
    );

    // Register Postgres-only metrics
    metrics.registry.removeSingleMetric("ponder_postgres_pool_connections");
    metrics.ponder_postgres_pool_connections = new prometheus.Gauge({
      name: "ponder_postgres_pool_connections",
      help: "Number of connections in the pool",
      labelNames: ["pool", "kind"] as const,
      registers: [metrics.registry],
      collect() {
        for (const [name, pool] of Object.entries(pools)) {
          this.set({ pool: name, kind: "idle" }, pool.idleCount);
          this.set({ pool: name, kind: "total" }, pool.totalCount);
        }
      },
    });

    metrics.registry.removeSingleMetric("ponder_postgres_query_queue_size");
    metrics.ponder_postgres_query_queue_size = new prometheus.Gauge({
      name: "ponder_postgres_query_queue_size",
      help: "Number of queries waiting for an available connection",
      labelNames: ["pool"] as const,
      registers: [metrics.registry],
      collect() {
        for (const [name, pool] of Object.entries(pools)) {
          this.set({ pool: name }, pool.waitingCount);
        }
      },
    });

    return {
      dialect: "postgres",
      admin: makeNodePostgresTransport(pools.admin),
      user: makeNodePostgresTransport(pools.user),
      readonly: makeNodePostgresTransport(pools.readonly),
      sync: makeNodePostgresTransport(pools.sync),
    };
  });

/**
 * Create the database, with a client for each transport.
 */
export const makeDb = (
  transports: DbTransports,
): Effect.Effect<Db["Service"], never, Metrics> =>
  Effect.gen(function* () {
    const metrics = yield* Metrics;

    return Db.of({
      dialect: transports.dialect,
      admin: makeDbClient(transports.admin, { metrics }),
      user: makeDbClient(transports.user, { metrics }),
      readonly: makeDbClient(transports.readonly, { metrics }),
      sync: makeDbClient(transports.sync, { metrics }),
      listen: (channel) =>
        transports.admin
          .listen(channel)
          .pipe(Effect.mapError((error) => parseDbError(error))),
    });
  });
