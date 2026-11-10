import type { SQL } from "bun";
import {
  type Cause,
  Effect,
  Queue,
  Schedule,
  type Scope,
  Semaphore,
  Stream,
} from "effect";
import {
  type CompiledStatement,
  DbError,
  type DbListenTransport,
  type DbTransport,
  type DbTransportTransaction,
} from "./transport.js";

export type BunPostgresOptions = {
  /** Connection options of `Bun.SQL`, such as the url, `max` and `tls`. */
  options: SQL.PostgresOrMySQLOptions;
  /** Postgres settings of each connection, such as `search_path`. */
  settings: Record<string, string>;
};

const XID_SQL = "SELECT txid_current_if_assigned()::text AS xid";
const COMMIT_STATUS_SQL = "SELECT txid_status($1::bigint) AS status";

/** Codes of an error that ends the session, after which Postgres rolls back an open transaction. */
const CONNECTION_LOST = new Set(["57P01", "57P02", "57P03"]);

/** `true` if Postgres answered with an error, so the session is still open. */
const isServerError = (cause: unknown) => {
  const error = cause as { code?: unknown; errno?: unknown } | undefined;
  return (
    error?.code === "ERR_POSTGRES_SERVER_ERROR" &&
    CONNECTION_LOST.has(String(error.errno)) === false
  );
};

const pad = (n: number, length = 2) => String(n).padStart(length, "0");

const fromDate =
  (format: (date: Date) => string) =>
  (value: unknown): unknown =>
    value instanceof Date ? format(value) : value;

const fromTypedArray = (value: unknown): unknown =>
  ArrayBuffer.isView(value) ? Array.from(value as Int32Array) : value;

/**
 * The values that node-postgres returns for the types that Bun parses
 * differently, by the OID of the type.
 */
const converters: { [type: number]: (value: unknown) => unknown } = {
  // date
  1082: fromDate(
    (date) =>
      `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`,
  ),
  // timestamp
  1114: fromDate((date) =>
    date.toISOString().replace("T", " ").replace("Z", ""),
  ),
  // timestamptz
  1184: fromDate((date) => date.toISOString()),
  // int4[]
  1007: fromTypedArray,
  // float4[]
  1021: fromTypedArray,
};

type Result = unknown[] & { columns?: { type: number }[] };

/** Rows with the values that drizzle decodes itself, as node-postgres returns them. */
const normalize = (result: Result, arrayMode: boolean): unknown[] => {
  const columns = result.columns ?? [];
  const converted = columns
    .map((column, index) => ({ index, convert: converters[column.type] }))
    .filter(({ convert }) => convert !== undefined);
  if (converted.length === 0) return result;

  const names = arrayMode
    ? undefined
    : Object.keys((result[0] as object | undefined) ?? {});
  for (const row of result as Record<string | number, unknown>[]) {
    for (const { index, convert } of converted) {
      const key = names === undefined ? index : names[index]!;
      row[key] = convert!(row[key]);
    }
  }
  return result;
};

type Session = Pick<SQL, "unsafe" | "json">;

const execute = async (
  session: Session,
  statement: CompiledStatement,
): Promise<unknown[]> => {
  if (statement.copy !== undefined) {
    const writer = session.unsafe(statement.sql).writable().getWriter();
    await writer.write(statement.copy);
    await writer.close();
    return [];
  }
  // Note: drizzle already encoded the value of a JSON parameter.
  const params = statement.typings?.includes("json")
    ? statement.params.map((param, i) =>
        statement.typings![i] === "json" && typeof param === "string"
          ? session.json(JSON.parse(param))
          : param,
      )
    : statement.params;
  const query = session.unsafe(statement.sql, params);
  const result = (await (statement.arrayMode
    ? query.values()
    : query)) as unknown as Result;
  return normalize(result, statement.arrayMode === true);
};

const executeAll = async (
  session: Session,
  statements: readonly CompiledStatement[],
  results: unknown[][],
) => {
  for (const statement of statements) {
    results.push(await execute(session, statement));
  }
};

const isSelect = (statements: readonly CompiledStatement[]) =>
  statements.length === 1 &&
  statements[0]!.copy === undefined &&
  /^\s*select\b/i.test(statements[0]!.sql);

/** Rejects `sql.begin`, so that Bun rolls back. */
class Rollback extends Error {}

/**
 * Transport for a `Bun.SQL` pool.
 *
 * @dev `Bun.SQL` runs a transaction in a callback. The transaction of `begin`
 * keeps the callback waiting until `commit` or the end of the scope.
 */
export const makeBunPostgresTransport = (
  SQLClass: typeof SQL,
  { options, settings }: BunPostgresOptions,
): Effect.Effect<DbListenTransport, never, Scope.Scope> =>
  Effect.gen(function* () {
    const make = (max?: number) =>
      new SQLClass({
        ...options,
        ...(max === undefined ? {} : { max }),
        connection: { ...settings },
      } as SQL.PostgresOrMySQLOptions);

    const client = yield* Effect.acquireRelease(
      Effect.sync(() => make()),
      (client) => Effect.promise(() => client.close()),
    );

    // The status of a transaction whose `COMMIT` got no answer, or `undefined`.
    const commitStatus = (xid: string) =>
      Effect.acquireUseRelease(
        Effect.sync(() => make(1)),
        (checker) =>
          Effect.tryPromise(() =>
            checker.unsafe(COMMIT_STATUS_SQL, [xid]),
          ).pipe(
            Effect.flatMap(([row]) =>
              row?.status === "in progress"
                ? Effect.fail(new Error("COMMIT in progress"))
                : Effect.succeed(row?.status as string | null | undefined),
            ),
          ),
        (checker) => Effect.promise(() => checker.close()),
      ).pipe(
        Effect.retry(Schedule.spaced("100 millis")),
        Effect.timeout("30 seconds"),
        Effect.orElseSucceed(() => undefined),
      );

    /**
     * The outcome of a transaction: `done` settles with the result of
     * `sql.begin`, after `COMMIT` or `ROLLBACK`.
     */
    const open = () =>
      new Promise<{
        tx: Session;
        finish: (commit: boolean) => Promise<void>;
      }>((resolve, reject) => {
        let end!: (commit: boolean) => void;
        const ended = new Promise<boolean>((resolve) => {
          end = resolve;
        });
        let began = false;
        const done = client.begin(async (tx) => {
          began = true;
          resolve({
            tx,
            finish: (commit) => {
              end(commit);
              return done;
            },
          });
          if ((await ended) === false) throw new Rollback();
        });
        done.catch((error) => {
          if (began === false) reject(error);
        });
      });

    /**
     * Send `COMMIT`. When it gets no answer, the status of the transaction
     * decides whether it committed.
     */
    const commit = (
      tx: Session,
      finish: (commit: boolean) => Promise<void>,
    ): Effect.Effect<void, DbError> =>
      Effect.promise(async (): Promise<Effect.Effect<void, DbError>> => {
        let xid: string | null;
        try {
          xid = ((await tx.unsafe(XID_SQL, [])) as { xid: string | null }[])[0]!
            .xid;
        } catch (cause) {
          await finish(false).catch(() => {});
          return Effect.fail(
            new DbError({
              sql: XID_SQL,
              cause,
              notApplied: true,
              aborted: true,
            }),
          );
        }
        try {
          await finish(true);
          return Effect.void;
        } catch (cause) {
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

    const begin = Effect.tryPromise({
      try: open,
      catch: (cause) => new DbError({ sql: "BEGIN", cause, notApplied: true }),
    });

    const run: DbTransport["run"] = (statements) => {
      if (isSelect(statements)) {
        return Effect.tryPromise({
          try: () => execute(client, statements[0]!),
          catch: (cause) =>
            new DbError({ sql: statements[0]!.sql, cause, notApplied: true }),
        }).pipe(Effect.map((rows) => [rows]));
      }

      return Effect.gen(function* () {
        const { tx, finish } = yield* begin;
        const results: unknown[][] = [];
        yield* Effect.tryPromise({
          try: () => executeAll(tx, statements, results),
          catch: (cause) =>
            new DbError({
              sql: statements[results.length]?.sql ?? "",
              cause,
              notApplied: true,
            }),
        }).pipe(
          Effect.tapError(() =>
            Effect.promise(() => finish(false).catch(() => {})),
          ),
        );
        yield* commit(tx, finish);
        return results;
      }).pipe(Effect.uninterruptible);
    };

    const beginScoped: DbTransport["begin"] = Effect.gen(function* () {
      const state = { done: false };
      const { tx, finish } = yield* Effect.acquireRelease(
        begin,
        ({ finish }) =>
          state.done
            ? Effect.void
            : Effect.promise(() => finish(false).catch(() => {})),
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
              await tx.unsafe("ROLLBACK TO SAVEPOINT ponder", []);
              return new DbError({ sql, cause, notApplied: true });
            } catch {}
          }
          state.done = true;
          await finish(false).catch(() => {});
          return new DbError({ sql, cause, notApplied: true, aborted: true });
        }).pipe(Effect.flatMap(Effect.fail));

      return {
        run: (statements, savepoint) =>
          lock
            .withPermit(
              Effect.suspend(() => {
                if (state.done) {
                  return Effect.fail(aborted(statements[0]?.sql ?? ""));
                }
                const results: unknown[][] = [];
                return Effect.tryPromise({
                  try: async () => {
                    if (savepoint) await tx.unsafe("SAVEPOINT ponder", []);
                    await executeAll(tx, statements, results);
                    if (savepoint) {
                      await tx.unsafe("RELEASE SAVEPOINT ponder", []);
                    }
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
              return commit(tx, finish);
            }),
          )
          .pipe(Effect.uninterruptible),
      } satisfies DbTransportTransaction;
    });

    const listen: DbListenTransport["listen"] = (channel) =>
      Effect.gen(function* () {
        const queue = yield* Queue.unbounded<string, DbError | Cause.Done>();
        const sql = `LISTEN "${channel}"`;
        yield* Effect.acquireRelease(
          Effect.tryPromise({
            try: () =>
              client.listen(channel, (payload) => {
                Queue.offerUnsafe(queue, payload);
              }),
            catch: (cause) => new DbError({ sql, cause, notApplied: true }),
          }),
          (subscription) =>
            Effect.promise(() => subscription.unlisten()).pipe(
              Effect.ensuring(Queue.end(queue)),
            ),
        );
        // Note: Bun reconnects the listening connection by itself.
        return Stream.fromQueue(queue);
      });

    return { dialect: "postgres", run, begin: beginScoped, listen };
  });
