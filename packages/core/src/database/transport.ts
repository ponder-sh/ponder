import type { PGlite, Transaction } from "@electric-sql/pglite";
import type { PgTransactionConfig } from "drizzle-orm/pg-core";
import { Cause, Effect, Exit, Queue, type Scope, Stream } from "effect";
import type pg from "pg";
import copy from "pg-copy-streams";
import type { Schema } from "@/internal/types.js";
import type { Drizzle } from "@/types/db.js";

/**
 * Runs statements on one database driver.
 *
 * @dev A transport does not retry, log, or parse errors. Failures are the errors
 * that the driver throws.
 */
export type DbTransport<TSchema extends Schema = Schema> = {
  dialect: "postgres" | "pglite";
  /** Drizzle database for building statements. */
  db: Drizzle<TSchema>;
  /** Run the statement that `build` returns. */
  query: <T>(
    build: (db: Drizzle<TSchema>) => T,
  ) => Effect.Effect<Awaited<T>, unknown>;
  /**
   * Run `f` in a transaction. A failure of `f` rolls back the transaction and
   * fails with the same cause. Interrupting waits for the rollback.
   */
  transaction: <A, E, R>(
    f: (tx: DbTransport<TSchema>) => Effect.Effect<A, E, R>,
    config?: PgTransactionConfig,
  ) => Effect.Effect<A, E | unknown, R>;
  /** Copy `text`, in the Postgres text format, into the table `target`. */
  copy: (target: string, text: string) => Effect.Effect<void, unknown>;
};

/**
 * Transport for a database, which can also receive notifications.
 */
export type DbListenTransport<TSchema extends Schema = Schema> =
  DbTransport<TSchema> & {
    /**
     * Listen for notifications on `channel` until the scope closes.
     *
     * @returns The stream of the payloads of notifications, which fails when
     * the connection fails.
     */
    listen: (
      channel: string,
    ) => Effect.Effect<Stream.Stream<string, unknown>, unknown, Scope.Scope>;
  };

const query =
  <TSchema extends Schema>(db: Drizzle<TSchema>) =>
  <T>(build: (db: Drizzle<TSchema>) => T): Effect.Effect<Awaited<T>, unknown> =>
    Effect.tryPromise({
      try: async (): Promise<Awaited<T>> => await build(db),
      catch: (error) => error,
    });

const transaction =
  <TSchema extends Schema>(
    db: Drizzle<TSchema>,
    makeTransport: (tx: Drizzle<TSchema>) => DbTransport<TSchema>,
  ): DbTransport<TSchema>["transaction"] =>
  <A, E, R>(
    f: (tx: DbTransport<TSchema>) => Effect.Effect<A, E, R>,
    config?: PgTransactionConfig,
  ) =>
    Effect.flatMap(Effect.context<R>(), (context) =>
      Effect.callback<A, E | unknown>((resume) => {
        const controller = new AbortController();
        let exit: Exit.Exit<A, E> | undefined;

        const done = (db as unknown as Drizzle)
          .transaction(async (tx) => {
            exit = await Effect.runPromiseExitWith(context)(
              f(makeTransport(tx as unknown as Drizzle<TSchema>)),
              { signal: controller.signal },
            );
            // Note: Throwing rolls back the transaction.
            if (Exit.isFailure(exit)) throw exit;
            return exit.value;
          }, config)
          .then(
            (value) => resume(Effect.succeed(value)),
            (error) =>
              resume(
                exit !== undefined && Exit.isFailure(exit)
                  ? exit
                  : Effect.fail(error),
              ),
          );

        return Effect.promise(() => {
          controller.abort();
          return done;
        });
      }),
    );

/** The client of a Drizzle transaction. */
const getTransactionClient = <client>(tx: Drizzle<any>): client =>
  // @ts-expect-error
  tx.session.client;

const nodePostgresTransport = <TSchema extends Schema>(
  db: Drizzle<TSchema>,
  withClient: <A, E>(
    f: (client: pg.PoolClient) => Effect.Effect<A, E>,
  ) => Effect.Effect<A, E | unknown>,
): DbTransport<TSchema> => ({
  dialect: "postgres",
  db,
  query: query(db),
  transaction: transaction(db, (tx) =>
    nodePostgresTransport(tx, (f) =>
      f(getTransactionClient<pg.PoolClient>(tx)),
    ),
  ),
  copy: (target, text) =>
    withClient((client) =>
      Effect.callback<void, unknown>((resume) => {
        let isDone = false;
        const copyStream = client.query(copy.from(`COPY ${target} FROM STDIN`));
        copyStream.on("finish", () => {
          isDone = true;
          resume(Effect.void);
        });
        copyStream.on("error", (error) => {
          isDone = true;
          resume(Effect.fail(error));
        });

        copyStream.write(text);
        copyStream.end();

        // Note: The text is already sent, so interrupting waits for the COPY
        // to finish before the client is released.
        return Effect.callback<void>((resume) => {
          if (isDone) return resume(Effect.void);
          copyStream.once("finish", () => resume(Effect.void));
          copyStream.once("error", () => resume(Effect.void));
        });
      }),
    ),
});

/**
 * Transport for a node-postgres pool.
 */
export const makeNodePostgresTransport = <TSchema extends Schema>(
  db: Drizzle<TSchema> & { $client: pg.Pool },
): DbListenTransport<TSchema> => {
  const pool = db.$client;

  const connect = Effect.acquireRelease(
    Effect.tryPromise({ try: () => pool.connect(), catch: (error) => error }),
    (client) => Effect.sync(() => client.release()),
  );

  return {
    ...nodePostgresTransport(db, (f) =>
      Effect.scoped(Effect.flatMap(connect, f)),
    ),
    listen: (channel) =>
      Effect.gen(function* () {
        const queue = yield* Queue.unbounded<string, unknown>();

        const onNotification = (notification: pg.Notification) => {
          if (notification.channel !== channel) return;
          Queue.offerUnsafe(queue, notification.payload ?? "");
        };
        const onError = (error: Error) => {
          Queue.failCauseUnsafe(queue, Cause.fail(error));
        };

        // Note: The connection is destroyed instead of returned to the pool,
        // so it doesn't keep listening on `channel`.
        const client = yield* Effect.acquireRelease(
          Effect.tryPromise({
            try: () => pool.connect(),
            catch: (error) => error,
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
          try: () => client.query(`LISTEN "${channel}"`),
          catch: (error) => error,
        });

        return Stream.fromQueue(queue);
      }),
  };
};

const pgliteTransport = <TSchema extends Schema>(
  db: Drizzle<TSchema>,
  client: PGlite | Transaction,
): DbTransport<TSchema> => ({
  dialect: "pglite",
  db,
  query: query(db),
  transaction: transaction(db, (tx) =>
    pgliteTransport(tx, getTransactionClient<Transaction>(tx)),
  ),
  copy: (target, text) =>
    Effect.tryPromise({
      try: () =>
        client.query(`COPY ${target} FROM '/dev/blob'`, [], {
          blob: new Blob([text]),
        }),
      catch: (error) => error,
    }).pipe(Effect.asVoid),
});

/**
 * Transport for a PGlite instance.
 */
export const makePgliteTransport = <TSchema extends Schema>(
  db: Drizzle<TSchema> & { $client: PGlite },
): DbListenTransport<TSchema> => {
  const instance = db.$client;

  return {
    ...pgliteTransport(db, instance),
    listen: (channel) =>
      Effect.gen(function* () {
        const queue = yield* Queue.unbounded<string, unknown>();

        yield* Effect.acquireRelease(
          Effect.tryPromise({
            try: () =>
              instance.listen(channel, (payload) => {
                Queue.offerUnsafe(queue, payload);
              }),
            catch: (error) => error,
          }),
          (unlisten) =>
            Effect.promise(() => unlisten()).pipe(
              Effect.ensuring(Queue.end(queue)),
            ),
        );

        return Stream.fromQueue(queue);
      }),
  };
};
