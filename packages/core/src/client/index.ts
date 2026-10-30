import {
  getTableName,
  getViewName,
  isTable,
  isView,
  type QueryWithTypings,
} from "drizzle-orm";
import {
  getViewConfig,
  type PgDialect,
  type PgSession,
  type PgView,
  pgSchema,
  pgTable,
} from "drizzle-orm/pg-core";
import { Deferred, Effect, Fiber, Result, Schedule, Stream } from "effect";
import type { Context as HonoContext } from "hono";
import { createMiddleware } from "hono/factory";
import { type SSEStreamingApi, streamSSE } from "hono/streaming";
import superjson from "superjson";
import { Db } from "@/database/db.js";
import type { PonderApp6 } from "@/database/index.js";
import { getLiveQueryChannelName } from "@/drizzle/onchain.js";
import type { Schema } from "@/internal/types.js";
import type { ReadonlyDrizzle } from "@/types/db.js";
import {
  getSQLQueryRelations,
  validateAllowableSQLQuery,
} from "@/utils/sql-parse.js";

type QueryString = string;
type QueryResult = unknown;
/** Query from `@ponder/client`. `method` is the drizzle method of the query. */
type ClientQuery = QueryWithTypings & { method?: "all" | "execute" };

const MAX_LIVE_QUERIES = 1000;

/**
 * @dev This is copied to avoid bundling another dependency.
 */
const getPonderMetaTable = (schema?: string) => {
  if (schema === undefined || schema === "public") {
    return pgTable("_ponder_meta", (t) => ({
      key: t.text().primaryKey().$type<"app">(),
      value: t.jsonb().$type<PonderApp6>().notNull(),
    }));
  }

  return pgSchema(schema).table("_ponder_meta", (t) => ({
    key: t.text().primaryKey().$type<"app">(),
    value: t.jsonb().$type<PonderApp6>().notNull(),
  }));
};

/** Run `promise`, failing with the error it rejects with. */
const tryPromise = <A>(promise: () => PromiseLike<A>) =>
  Effect.tryPromise({ try: promise, catch: (error) => error });

/**
 * Middleware for `@ponder/client`.
 *
 * @param db - Drizzle database instance
 * @param schema - Ponder schema
 *
 * @example
 * ```ts
 * import { db } from "ponder:api";
 * import schema from "ponder:schema";
 * import { Hono } from "hono";
 * import { client } from "ponder";
 *
 * const app = new Hono();
 *
 * app.use("/sql/*", client({ db, schema }));
 *
 * export default app;
 * ```
 */
export const client = ({
  db,
  schema,
}: {
  db: ReadonlyDrizzle<Schema>;
  schema: Schema;
}) => {
  if (
    globalThis.PONDER_API_CONTEXT === undefined ||
    globalThis.PONDER_NAMESPACE_BUILD === undefined ||
    globalThis.PONDER_PRE_BUILD === undefined
  ) {
    throw new Error(
      "client() middleware cannot be initialized outside of a Ponder project",
    );
  }

  return Effect.runSyncWith(globalThis.PONDER_API_CONTEXT)(
    makeClient({ db, schema }),
  );
};

/**
 * Create the `@ponder/client` middleware. The readiness check and the listen
 * connection stop when the scope closes.
 */
const makeClient = ({
  db,
  schema,
}: {
  db: ReadonlyDrizzle<Schema>;
  schema: Schema;
}) =>
  Effect.gen(function* () {
    const database = yield* Db;
    const runPromise = Effect.runPromiseWith(yield* Effect.context<Db>());

    const tables = Object.values(schema).filter(isTable);
    const views = Object.values(schema).filter(isView);
    const tableNames = new Set(tables.map(getTableName));
    const viewNames = new Set(views.map(getViewName));

    // Note: Add system tables to the live query registry.
    tableNames.add("_ponder_checkpoint");

    // @ts-expect-error
    const session: PgSession = db._.session;
    // @ts-expect-error
    const dialect: PgDialect = session.dialect;

    const cache = makeQueryCache();
    const tableChanges = makeTableChanges(tableNames);

    /** `true` if the app is indexing live blocks. */
    let isReady = false;
    let liveQueryCount = 0;

    yield* Effect.forkScoped(
      database.readonly
        .query(
          (db) =>
            db
              .select()
              .from(getPonderMetaTable())
              .then((result) => result[0]!.value.is_ready === 1),
          { label: "select_ready" },
        )
        .pipe(
          Effect.orElseSucceed(() => false),
          Effect.repeat({
            until: (isReady) => isReady,
            schedule: Schedule.spaced(1000),
          }),
          Effect.andThen(
            Effect.sync(() => {
              isReady = true;
            }),
          ),
        ),
    );

    const viewTables = yield* Effect.forkScoped(
      resolveViewTables({
        views: views as PgView[],
        tableNames,
        viewNames,
        dialect,
      }),
    );

    const onNotification = (payload: string) =>
      Effect.gen(function* () {
        let tables = JSON.parse(payload) as string[];

        // Convert partition names to table names
        if (
          database.dialect === "postgres" &&
          globalThis.PONDER_PRE_BUILD.ordering === "experimental_isolated"
        ) {
          tables = tables.map((table) => {
            const _table = table.split("_");
            _table.pop();
            return _table.join("_");
          });
        }

        tables.push("_ponder_checkpoint");

        const invalidQueryCount = cache.invalidate(tables);
        tableChanges.changed(tables);

        if (invalidQueryCount > 0) {
          yield* Effect.logDebug({
            msg: "Updated live queries",
            tables: JSON.stringify(tables),
            query_count: invalidQueryCount,
          });
        }
      });

    const channel = getLiveQueryChannelName(
      globalThis.PONDER_NAMESPACE_BUILD.schema,
    );

    yield* Effect.forkScoped(
      Effect.gen(function* () {
        const notifications = yield* database.listen(channel);

        if (database.dialect === "postgres") {
          yield* Effect.logInfo({
            msg: `Established listen connection for "@ponder/client" middleware`,
          });
        }

        yield* Stream.runForEach(notifications, onNotification);
      }).pipe(
        Effect.scoped,
        Effect.catch((error) =>
          Effect.logWarning({
            msg: `Failed listen connection for "@ponder/client" middleware`,
            retry_delay: 250,
            error: error as Error,
          }).pipe(Effect.andThen(Effect.sleep(250))),
        ),
        Effect.forever,
      ),
    );

    const getQueryResult = (
      query: ClientQuery,
    ): Effect.Effect<QueryResult, unknown> => {
      // Note: Rows of a select are arrays so that columns with the same name
      // (e.g. from a join) don't overwrite each other.
      const execute = (session: PgSession<any, any, any>) =>
        query.method === "all"
          ? session
              .prepareQuery(query, undefined, undefined, true, (rows) => ({
                rows,
              }))
              .execute()
          : session.prepareQuery(query, undefined, undefined, false).execute();

      if (database.dialect === "pglite") {
        return tryPromise(() => execute(session));
      } else {
        return tryPromise(() =>
          database.readonly.drizzle.transaction((tx) => execute(tx._.session), {
            accessMode: "read only",
          }),
        );
      }
    };

    /** Return the tables that `query` reads, including through views. */
    const getReferencedTables = (
      query: QueryWithTypings,
      perViewTables: Map<string, Set<string>>,
    ) =>
      Effect.gen(function* () {
        const relations = yield* tryPromise(() =>
          getSQLQueryRelations(query.sql),
        );
        const referencedTables = new Set<string>();
        for (const relation of relations) {
          if (tableNames.has(relation)) {
            referencedTables.add(relation);
          } else if (viewNames.has(relation)) {
            for (const tableName of perViewTables.get(relation)!) {
              referencedTables.add(tableName);
            }
          }
        }
        return referencedTables;
      });

    /** `GET /sql/db` */
    const handleDb = (
      c: HonoContext,
      perViewTables: Map<string, Set<string>>,
    ) =>
      Effect.gen(function* () {
        const parsed = yield* parseQuery(c);
        if (Result.isFailure(parsed)) return parsed.failure;
        const { queryString, query } = parsed.success;

        const referencedTables = yield* getReferencedTables(
          query,
          perViewTables,
        );

        const result = yield* Effect.result(
          isReady === false
            ? getQueryResult(query)
            : cache.get(queryString, referencedTables, getQueryResult(query)),
        );
        if (Result.isFailure(result)) return errorResponse(c, result.failure);

        return c.json(result.success as object);
      });

    /**
     * Send the result of `query` to `stream` each time it changes, until the
     * stream closes.
     */
    const sendUpdates = ({
      stream,
      queryString,
      query,
      referencedTables,
      resultHash,
      crypto,
    }: {
      stream: SSEStreamingApi;
      queryString: QueryString;
      query: QueryWithTypings;
      referencedTables: Set<string>;
      resultHash: string;
      crypto: typeof import("node:crypto");
    }) =>
      Effect.gen(function* () {
        while (stream.closed === false && stream.aborted === false) {
          yield* tableChanges.waitForChange(referencedTables);

          yield* Effect.gen(function* () {
            const result = yield* cache.get(
              queryString,
              referencedTables,
              getQueryResult(query),
            );

            const _resultHash = hashResult(crypto, result);
            if (_resultHash === resultHash) return;
            resultHash = _resultHash;

            yield* tryPromise(() =>
              stream.writeSSE({ data: JSON.stringify(result) }),
            );
          }).pipe(Effect.catchCause(() => Effect.sync(() => stream.abort())));
        }
      });

    /** `GET /sql/live` */
    const handleLive = (
      c: HonoContext,
      perViewTables: Map<string, Set<string>>,
    ) =>
      Effect.gen(function* () {
        if (isReady === false) {
          return c.text(
            "Live queries are not available until the backfill is complete",
            503,
          );
        }

        if (liveQueryCount >= MAX_LIVE_QUERIES) {
          return c.text("Maximum number of live queries reached", 503);
        }

        liveQueryCount++;
        let hasLiveQuerySlot = true;
        let isStreaming = false;
        const releaseLiveQuerySlot = () => {
          if (hasLiveQuerySlot === false) return;
          hasLiveQuerySlot = false;
          liveQueryCount--;
        };

        return yield* Effect.gen(function* () {
          c.header("Content-Type", "text/event-stream");
          c.header("Cache-Control", "no-cache");
          c.header("Connection", "keep-alive");

          const parsed = yield* parseQuery(c);
          if (Result.isFailure(parsed)) return parsed.failure;
          const { queryString, query } = parsed.success;

          const referencedTables = yield* getReferencedTables(
            query,
            perViewTables,
          );

          const crypto = yield* Effect.promise(
            () => import(/* webpackIgnore: true */ "node:crypto"),
          );
          const resultHash = hashResult(
            crypto,
            yield* cache.get(
              queryString,
              referencedTables,
              getQueryResult(query),
            ),
          );

          const response = streamSSE(c, (stream) => {
            stream.onAbort(releaseLiveQuerySlot);
            return runPromise(
              sendUpdates({
                stream,
                queryString,
                query,
                referencedTables,
                resultHash,
                crypto,
              }),
            );
          });
          isStreaming = true;
          return response;
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              if (isStreaming === false) releaseLiveQuerySlot();
            }),
          ),
        );
      });

    return createMiddleware((c, next) =>
      runPromise(
        Effect.gen(function* () {
          const perViewTables = yield* Fiber.join(viewTables);

          if (c.req.path === "/sql/db") {
            return yield* handleDb(c, perViewTables);
          }

          if (c.req.path === "/sql/live") {
            return yield* handleLive(c, perViewTables);
          }

          return yield* tryPromise(() => next());
        }),
      ),
    );
  });

/**
 * Cache of query results by query string. A result stays cached until a
 * notification for one of its tables invalidates it, or it's garbage
 * collected.
 */
const makeQueryCache = () => {
  const cache = new Map<
    QueryString,
    WeakRef<Deferred.Deferred<QueryResult, unknown>>
  >();
  const perQueryReferences = new Map<QueryString, Set<string>>();

  const registry = new FinalizationRegistry<QueryString>((queryString) => {
    // Note: When a cache entry is garbage collected, delete the key from `perQueryReferences`.
    cache.delete(queryString);
    perQueryReferences.delete(queryString);
  });

  return {
    /**
     * Get the result of `queryString` from the cache, or run `query` and cache
     * its result until the rows of `referencedTables` change.
     *
     * @dev The query runs in its own fiber, so requests that share the result
     * don't depend on the request that started it.
     */
    get: (
      queryString: QueryString,
      referencedTables: Set<string>,
      query: Effect.Effect<QueryResult, unknown>,
    ): Effect.Effect<QueryResult, unknown> =>
      Effect.gen(function* () {
        let result = cache.get(queryString)?.deref();

        if (result === undefined) {
          cache.delete(queryString);
          result = Deferred.makeUnsafe<QueryResult, unknown>();
          yield* Effect.forkDetach(Deferred.into(query, result));
          cache.set(queryString, new WeakRef(result));
          perQueryReferences.set(queryString, referencedTables);
          registry.register(result, queryString);
        }

        return yield* Deferred.await(result);
      }),
    /**
     * Delete the results of the queries that read one of `tables`.
     *
     * @returns The number of deleted results.
     */
    invalidate: (tables: string[]): number => {
      let invalidQueryCount = 0;

      for (const [queryString, referencedTables] of perQueryReferences) {
        let isQueryInvalid = false;
        for (const table of tables) {
          if (referencedTables.has(table)) {
            isQueryInvalid = true;
            break;
          }
        }

        if (isQueryInvalid) {
          invalidQueryCount++;

          const result = cache.get(queryString)?.deref();
          if (result) registry.unregister(result);

          cache.delete(queryString);
          perQueryReferences.delete(queryString);
        }
      }

      return invalidQueryCount;
    },
  };
};

/**
 * A signal for each table in `tableNames` that completes when the rows of the
 * table change.
 */
const makeTableChanges = (tableNames: Set<string>) => {
  /** Completes when the rows of the table change, and is then replaced. */
  const perTableChange = new Map<string, Deferred.Deferred<void>>();
  for (const table of tableNames) {
    perTableChange.set(table, Deferred.makeUnsafe<void>());
  }

  return {
    /** Complete the signals of `tables`. */
    changed: (tables: string[]) => {
      for (const table of tables) {
        const change = perTableChange.get(table);
        // Note: Tables of the app that aren't in `schema` have no live queries.
        if (change === undefined) continue;
        Deferred.doneUnsafe(change, Effect.void);
        perTableChange.set(table, Deferred.makeUnsafe<void>());
      }
    },
    /** Wait until the rows of one of `tables` change. */
    waitForChange: (tables: Set<string>): Effect.Effect<void> =>
      Effect.suspend(() =>
        Effect.raceAll(
          Array.from(tables).map((table) =>
            Deferred.await(perTableChange.get(table)!),
          ),
        ),
      ),
  };
};

/**
 * Resolve the tables that each view reads, including through other views.
 */
const resolveViewTables = ({
  views,
  tableNames,
  viewNames,
  dialect,
}: {
  views: PgView[];
  tableNames: Set<string>;
  viewNames: Set<string>;
  dialect: PgDialect;
}) =>
  Effect.gen(function* () {
    const unresolvedViewRelations = new Map<string, Set<string>>();
    for (const view of views) {
      const query = dialect.sqlToQuery(getViewConfig(view).query!);
      const relations = yield* tryPromise(() =>
        getSQLQueryRelations(query.sql),
      );

      unresolvedViewRelations.set(getViewName(view), relations);
    }

    const perViewTables = new Map<string, Set<string>>();

    /**
     * Recursively resolve nested views (views that reference other views).
     *
     * @dev This assumes views cannot be infinitely cursive - an invariant enforced by Postgres.
     */
    const resolveRelation = (relation: string): Set<string> => {
      if (perViewTables.has(relation)) {
        return perViewTables.get(relation)!;
      }

      if (tableNames.has(relation)) {
        return new Set([relation]);
      }

      if (viewNames.has(relation)) {
        const result = new Set<string>();
        for (const _relation of unresolvedViewRelations.get(relation)!) {
          for (const __relation of resolveRelation(_relation)) {
            result.add(__relation);
          }
        }
        return result;
      }

      return new Set();
    };

    for (const [viewName, relations] of unresolvedViewRelations) {
      const resolvedRelations = new Set<string>();
      for (const relation of relations) {
        for (const _relation of resolveRelation(relation)) {
          resolvedRelations.add(_relation);
        }
      }
      perViewTables.set(viewName, resolvedRelations);
    }

    return perViewTables;
  });

/**
 * Parse and validate the query in the `sql` parameter.
 *
 * @returns The query, or the response for a missing or invalid query.
 */
const parseQuery = (
  c: HonoContext,
): Effect.Effect<
  Result.Result<{ queryString: QueryString; query: QueryWithTypings }, Response>
> =>
  Effect.gen(function* () {
    const queryString = c.req.query("sql");
    if (queryString === undefined) {
      return Result.fail(c.text('Missing "sql" query parameter', 400));
    }
    const query = superjson.parse(queryString) as ClientQuery;

    const validation = yield* Effect.result(
      tryPromise(() => validateAllowableSQLQuery(query.sql)),
    );
    if (Result.isFailure(validation)) {
      return Result.fail(errorResponse(c, validation.failure));
    }

    return Result.succeed({ queryString, query });
  });

/** Respond with the message of `error`, without its stack. */
const errorResponse = (c: HonoContext, error: unknown) => {
  (error as Error).stack = undefined;
  return c.text((error as Error).message, 500);
};

const hashResult = (
  crypto: typeof import("node:crypto"),
  result: QueryResult,
) =>
  crypto
    .createHash("MD5")
    // @ts-expect-error
    .update(JSON.stringify(result.rows))
    .digest("hex")
    .slice(0, 10);
