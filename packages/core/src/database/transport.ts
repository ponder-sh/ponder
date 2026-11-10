import { type PGlite, types as pgliteTypes } from "@electric-sql/pglite";
import {
  Cause,
  Data,
  Effect,
  Queue,
  Schedule,
  type Scope,
  Semaphore,
  Stream,
} from "effect";
import pg from "pg";
import copyStreams from "pg-copy-streams";

/** A statement whose SQL and parameters are fixed. */
export type CompiledStatement = {
  sql: string;
  params: unknown[];
  /** Rows are arrays of column values, instead of objects. */
  arrayMode?: boolean;
  /** Rows in the Postgres text format, for a `COPY ... FROM STDIN` statement. */
  copy?: string;
  /** Maps the rows to the result of the statement. The client runs it, not the transport. */
  decode?: (rows: unknown[]) => unknown;
  /** drizzle's type of each parameter, such as `"json"`. */
  typings?: string[];
};

export class DbError extends Data.TaggedError("DbError")<{
  sql: string;
  cause: unknown;
  /** The work is known to have not applied, so running it again is safe. */
  notApplied: boolean;
  /** The transaction rolled back and can't run more statements. */
  aborted?: boolean;
}> {
  override get message() {
    const message = (this.cause as Error | undefined)?.message ?? "";
    const sql = this.sql.replaceAll(/\s+/g, " ").trim();
    return `${message} (${sql.length > 120 ? `${sql.slice(0, 120)}...` : sql})`;
  }
}

/** A transaction that stays open until `commit`, or until the scope closes, which rolls it back. */
export type DbTransportTransaction = {
  /**
   * Run `statements` in order. With `savepoint`, a failure rolls back only
   * these statements, so the transaction can continue.
   */
  run: (
    statements: readonly CompiledStatement[],
    savepoint: boolean,
  ) => Effect.Effect<unknown[][], DbError>;
  commit: Effect.Effect<void, DbError>;
};

/**
 * Runs statements on one database driver. A transport does not retry: it sets
 * `notApplied` on a failure that is safe to retry.
 */
export type DbTransport = {
  dialect: "postgres" | "pglite";
  /**
   * Run `statements` in one transaction, in order, and return the rows of
   * each. A single `SELECT` runs without a transaction.
   */
  run: (
    statements: readonly CompiledStatement[],
  ) => Effect.Effect<unknown[][], DbError>;
  /** Open a transaction for the scope. */
  begin: Effect.Effect<DbTransportTransaction, DbError, Scope.Scope>;
};

export type DbListenTransport = DbTransport & {
  /**
   * Listen for notifications on `channel` until the scope closes.
   *
   * @returns The stream of the payloads, which fails when the connection fails.
   */
  listen: (
    channel: string,
  ) => Effect.Effect<Stream.Stream<string, DbError>, DbError, Scope.Scope>;
};

const XID_SQL = "SELECT txid_current_if_assigned()::text AS xid";
const COMMIT_STATUS_SQL = "SELECT txid_status($1::bigint) AS status";

const isSelect = (statements: readonly CompiledStatement[]) =>
  statements.length === 1 &&
  statements[0]!.copy === undefined &&
  /^\s*select\b/i.test(statements[0]!.sql);

// node-postgres

/** The types that drizzle parses itself, so node-postgres returns their text. */
const RAW_TYPES = new Set([
  1082, 1114, 1115, 1182, 1184, 1185, 1186, 1187, 1231,
]);
const raw = (value: string) => value;
const nodePostgresTypes = {
  getTypeParser: (id: number, format?: "text" | "binary") =>
    RAW_TYPES.has(id) ? raw : pg.types.getTypeParser(id, format as any),
} as pg.CustomTypesConfig;

/** Codes of an error that ends the session, after which Postgres rolls back an open transaction. */
const CONNECTION_LOST = new Set(["57P01", "57P02", "57P03"]);

/** `true` if Postgres answered with an error, so the session is still open. */
const isServerError = (cause: unknown) =>
  cause instanceof pg.DatabaseError &&
  CONNECTION_LOST.has(cause.code ?? "") === false;

const executeNodePostgres = (
  client: pg.Pool | pg.PoolClient,
  statement: CompiledStatement,
): Promise<unknown[]> => {
  if (statement.copy !== undefined) {
    const text = statement.copy;
    return new Promise((resolve, reject) => {
      const stream = (client as pg.PoolClient).query(
        copyStreams.from(statement.sql),
      );
      stream.on("finish", () => resolve([]));
      stream.on("error", reject);
      stream.end(text);
    });
  }
  return client
    .query({
      text: statement.sql,
      values: statement.params,
      rowMode: statement.arrayMode ? "array" : undefined,
      types: nodePostgresTypes,
    } as pg.QueryArrayConfig)
    .then((result: pg.QueryResult | pg.QueryResult[]) =>
      Array.isArray(result) ? (result.at(-1)?.rows ?? []) : result.rows,
    );
};

/** Run each statement on `client`, and return the index of the one that failed with the error. */
const executeAll = async (
  client: pg.PoolClient,
  statements: readonly CompiledStatement[],
  results: unknown[][],
) => {
  for (const statement of statements) {
    results.push(await executeNodePostgres(client, statement));
  }
};

/**
 * Transport for a node-postgres pool.
 */
export const makeNodePostgresTransport = (pool: pg.Pool): DbListenTransport => {
  // The status of a transaction whose `COMMIT` got no answer, or `undefined`.
  // It uses its own connection, since the pool may be busy or failing.
  const commitStatus = (xid: string) =>
    Effect.acquireUseRelease(
      Effect.tryPromise(async () => {
        const client = new pg.Client(
          (pool as unknown as { options: pg.ClientConfig }).options,
        );
        await client.connect();
        return client;
      }),
      (client) =>
        Effect.tryPromise(() => client.query(COMMIT_STATUS_SQL, [xid])).pipe(
          Effect.flatMap(({ rows: [row] }) =>
            row?.status === "in progress"
              ? Effect.fail(new Error("COMMIT in progress"))
              : Effect.succeed(row?.status as string | null | undefined),
          ),
        ),
      (client) => Effect.promise(() => client.end().catch(() => {})),
    ).pipe(
      Effect.retry(Schedule.spaced("100 millis")),
      Effect.timeout("30 seconds"),
      Effect.orElseSucceed(() => undefined),
    );

  /**
   * Send `COMMIT`. When it gets no answer, the status of the transaction
   * decides whether it committed.
   */
  const commit = (client: pg.PoolClient) =>
    Effect.promise(async (): Promise<Effect.Effect<void, DbError>> => {
      let xid: string | null;
      try {
        xid = (await client.query(XID_SQL)).rows[0]?.xid ?? null;
      } catch (cause) {
        client.release(true);
        return Effect.fail(
          new DbError({ sql: XID_SQL, cause, notApplied: true, aborted: true }),
        );
      }
      try {
        await client.query("COMMIT");
        client.release();
        return Effect.void;
      } catch (cause) {
        client.release(true);
        if (isServerError(cause)) {
          return Effect.fail(
            new DbError({
              sql: "COMMIT",
              cause,
              notApplied: true,
              aborted: true,
            }),
          );
        }
        // A transaction without an id wrote nothing.
        if (xid === null) return Effect.void;
        return Effect.flatMap(commitStatus(xid), (status) =>
          status === "committed"
            ? Effect.void
            : Effect.fail(
                new DbError({
                  sql: "COMMIT",
                  cause,
                  notApplied: status === "aborted",
                  aborted: true,
                }),
              ),
        );
      }
    }).pipe(Effect.flatten);

  const connect = Effect.tryPromise({
    try: () => pool.connect(),
    catch: (cause) => new DbError({ sql: "BEGIN", cause, notApplied: true }),
  });

  // Note: The whole transaction runs on one connection, so a lost connection
  // can't run later statements on another session.
  const run: DbTransport["run"] = (statements) => {
    if (isSelect(statements)) {
      return Effect.tryPromise({
        try: () => executeNodePostgres(pool, statements[0]!),
        catch: (cause) =>
          new DbError({ sql: statements[0]!.sql, cause, notApplied: true }),
      }).pipe(Effect.map((rows) => [rows]));
    }

    return Effect.gen(function* () {
      const client = yield* connect;
      const results: unknown[][] = [];
      yield* Effect.tryPromise({
        try: async () => {
          await client.query("BEGIN");
          await executeAll(client, statements, results);
        },
        catch: (cause) => {
          client.release(true);
          return new DbError({
            sql: statements[results.length]?.sql ?? "BEGIN",
            cause,
            notApplied: true,
          });
        },
      });
      yield* commit(client);
      return results;
    }).pipe(Effect.uninterruptible);
  };

  const begin: DbTransport["begin"] = Effect.gen(function* () {
    const state = { done: false };
    const client = yield* Effect.acquireRelease(
      Effect.flatMap(connect, (client) =>
        Effect.tryPromise({
          try: () => client.query("BEGIN").then(() => client),
          catch: (cause) => {
            client.release(true);
            return new DbError({ sql: "BEGIN", cause, notApplied: true });
          },
        }),
      ),
      (client) =>
        state.done
          ? Effect.void
          : Effect.promise(() =>
              client.query("ROLLBACK").then(
                () => client.release(),
                (error: Error) => client.release(error),
              ),
            ),
    );
    const lock = yield* Semaphore.make(1);

    const aborted = (sql: string) =>
      new DbError({
        sql,
        cause: new Error("The transaction already rolled back"),
        notApplied: true,
        aborted: true,
      });

    const fail = (cause: unknown, sql: string, savepoint: boolean) =>
      Effect.promise(async () => {
        if (savepoint && isServerError(cause)) {
          try {
            await client.query("ROLLBACK TO SAVEPOINT ponder");
            return new DbError({ sql, cause, notApplied: true });
          } catch {}
        }
        state.done = true;
        client.release(true);
        return new DbError({ sql, cause, notApplied: true, aborted: true });
      }).pipe(Effect.flatMap(Effect.fail));

    return {
      run: (statements, savepoint) =>
        lock
          .withPermit(
            Effect.suspend(() => {
              if (state.done)
                return Effect.fail(aborted(statements[0]?.sql ?? ""));
              const results: unknown[][] = [];
              return Effect.tryPromise({
                try: async () => {
                  if (savepoint) await client.query("SAVEPOINT ponder");
                  await executeAll(client, statements, results);
                  if (savepoint) await client.query("RELEASE SAVEPOINT ponder");
                  return results;
                },
                catch: (cause) => cause,
              }).pipe(
                Effect.catch((cause) =>
                  fail(
                    cause,
                    statements[results.length]?.sql ?? "SAVEPOINT",
                    savepoint,
                  ),
                ),
              );
            }),
          )
          .pipe(Effect.uninterruptible),
      commit: lock
        .withPermit(
          Effect.suspend(() => {
            if (state.done) return Effect.fail(aborted("COMMIT"));
            state.done = true;
            return commit(client);
          }),
        )
        .pipe(Effect.uninterruptible),
    } satisfies DbTransportTransaction;
  });

  const listen: DbListenTransport["listen"] = (channel) =>
    Effect.gen(function* () {
      const queue = yield* Queue.unbounded<string, DbError | Cause.Done>();
      const sql = `LISTEN "${channel}"`;

      const onNotification = (notification: pg.Notification) => {
        if (notification.channel !== channel) return;
        Queue.offerUnsafe(queue, notification.payload ?? "");
      };
      const onError = (cause: Error) => {
        Queue.failCauseUnsafe(
          queue,
          Cause.fail(new DbError({ sql, cause, notApplied: false })),
        );
      };

      // Note: The connection is destroyed instead of returned to the pool,
      // so it doesn't keep listening on `channel`.
      const client = yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: () => pool.connect(),
          catch: (cause) => new DbError({ sql, cause, notApplied: true }),
        }),
        (client) =>
          Effect.sync(() => {
            client.off("notification", onNotification);
            client.off("error", onError);
            client.release(true);
            Queue.endUnsafe(queue);
          }),
      );

      client.on("notification", onNotification);
      client.on("error", onError);

      yield* Effect.tryPromise({
        try: () => client.query(sql),
        catch: (cause) => new DbError({ sql, cause, notApplied: true }),
      });

      return Stream.fromQueue(queue);
    });

  return { dialect: "postgres", run, begin, listen };
};

// PGlite

const pgliteParsers = {
  [pgliteTypes.TIMESTAMP]: raw,
  [pgliteTypes.TIMESTAMPTZ]: raw,
  [pgliteTypes.INTERVAL]: raw,
  [pgliteTypes.DATE]: raw,
};

const executePglite = (
  client: Pick<PGlite, "query">,
  statement: CompiledStatement,
): Promise<unknown[]> =>
  statement.copy === undefined
    ? client
        .query(statement.sql, statement.params, {
          rowMode: statement.arrayMode ? "array" : "object",
          parsers: pgliteParsers,
        })
        .then((result) => result.rows)
    : client
        .query(statement.sql.replace(/ FROM STDIN$/, " FROM '/dev/blob'"), [], {
          blob: new Blob([statement.copy]),
        })
        .then(() => []);

/**
 * Transport for a PGlite instance.
 *
 * @dev PGlite runs one statement at a time, and an open transaction makes the
 * statements of every other client wait. A list of statements runs in a
 * transaction, since no other work happens until it ends. An open transaction
 * from `begin` could wait on another client that waits on it, so `begin` runs
 * each list in its own transaction instead, and `commit` does nothing.
 */
export const makePgliteTransport = (instance: PGlite): DbListenTransport => {
  const run: DbTransport["run"] = (statements) => {
    let at = 0;
    return Effect.tryPromise({
      try: async () => {
        if (statements.length === 1) {
          return [await executePglite(instance, statements[0]!)];
        }
        return instance.transaction(async (tx) => {
          const results: unknown[][] = [];
          for (; at < statements.length; at++) {
            results.push(await executePglite(tx, statements[at]!));
          }
          return results;
        }) as Promise<unknown[][]>;
      },
      catch: (cause) =>
        new DbError({
          sql: statements[at]?.sql ?? "",
          cause,
          notApplied: true,
        }),
    });
  };

  const listen: DbListenTransport["listen"] = (channel) =>
    Effect.gen(function* () {
      const queue = yield* Queue.unbounded<string, DbError | Cause.Done>();

      yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: () =>
            instance.listen(channel, (payload) => {
              Queue.offerUnsafe(queue, payload);
            }),
          catch: (cause) =>
            new DbError({
              sql: `LISTEN "${channel}"`,
              cause,
              notApplied: true,
            }),
        }),
        (unlisten) =>
          Effect.promise(() => unlisten()).pipe(
            Effect.ensuring(Queue.end(queue)),
          ),
      );

      return Stream.fromQueue(queue);
    });

  return {
    dialect: "pglite",
    run,
    begin: Effect.succeed({
      run: (statements) => run(statements),
      commit: Effect.void,
    }),
    listen,
  };
};
