import { getLiveQueryChannelName } from "@/drizzle/onchain.js";
import type { Schema } from "@/internal/types.js";
import type { ReadonlyDrizzle } from "@/types/db.js";
import {
  type PromiseWithResolvers,
  promiseWithResolvers,
} from "@/utils/promiseWithResolvers.js";
import {
  getSQLQueryRelations,
  validateAllowableSQLQuery,
} from "@/utils/sql-parse.js";
import {
  type QueryWithTypings,
  getTableName,
  getViewName,
  isTable,
  isView,
} from "drizzle-orm";
import {
  type PgDialect,
  type PgSession,
  type PgView,
  getViewConfig,
} from "drizzle-orm/pg-core";
import { createMiddleware } from "hono/factory";
import { streamSSE } from "hono/streaming";
import type * as pg from "pg";
import superjson from "superjson";

type QueryString = string;
type QueryResult = unknown;

const MAX_LIVE_QUERIES = 1000;

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
}: { db: ReadonlyDrizzle<Schema>; schema: Schema }) => {
  if (
    globalThis.PONDER_COMMON === undefined ||
    globalThis.PONDER_DATABASE === undefined ||
    globalThis.PONDER_NAMESPACE_BUILD === undefined
  ) {
    throw new Error(
      "client() middleware cannot be initialized outside of a Ponder project",
    );
  }

  const tables = Object.values(schema).filter(isTable);
  const views = Object.values(schema).filter(isView);
  const tableNames = new Set(tables.map(getTableName));
  const viewNames = new Set(views.map(getViewName));

  // @ts-ignore
  const session: PgSession = db._.session;
  // @ts-ignore
  const dialect: PgDialect = session.dialect;
  const driver = globalThis.PONDER_DATABASE.driver;

  const cache = new Map<QueryString, WeakRef<Promise<unknown>>>();
  /** Tables that have updated in the current transaction. */
  const liveQueryUpdatedTables = new Set<string>();
  const perTableResolver = new Map<string, PromiseWithResolvers<void>>();
  const perTableQueries = new Map<string, Map<QueryString, number>>();
  const perViewTables = new Map<string, Set<string>>();
  /** `true` if the app is indexing live blocks. */
  let isLive = false;
  let liveQueryCount = 0;

  for (const table of tableNames) {
    perTableResolver.set(table, promiseWithResolvers<void>());
    perTableQueries.set(table, new Map());
  }

  const parseViewPromise = (async () => {
    const unresolvedViewRelations = new Map<string, Set<string>>();
    for (const view of views) {
      const query = dialect.sqlToQuery(getViewConfig(view as PgView).query!);
      const relations = await getSQLQueryRelations(query.sql);

      unresolvedViewRelations.set(getViewName(view), relations);
    }

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
  })();

  if (driver.dialect === "pglite") {
    for (const table of tables) {
      driver.instance.query(`LISTEN "${getLiveQueryChannelName(table)}"`);
    }
    // Note: Don't use the `getLiveQueryChannelName` function here because we want minimal imports for bundling.
    driver.instance.query(
      `LISTEN "live_query_channel_${globalThis.PONDER_NAMESPACE_BUILD.schema ?? "public"}__ponder_checkpoint"`,
    );

    driver.instance.onNotification((channel) => {
      const table = channel.slice(
        "live_query_channel_".length +
          (globalThis.PONDER_NAMESPACE_BUILD.schema ?? "public").length +
          1,
      );

      // Note: only act when the "_ponder_checkpoint" table is updated
      // because tables can be updated multiple times in a single transaction
      // and the notification is only sent once for the entire transaction

      if (table === "_ponder_checkpoint") {
        isLive = true;

        for (const table of liveQueryUpdatedTables) {
          for (const [queryString] of perTableQueries.get(table)!) {
            cache.delete(queryString);

            const count = perTableQueries.get(table)!.get(queryString)!;
            if (count === 1) {
              perTableQueries.get(table)!.delete(queryString);
            } else {
              perTableQueries.get(table)!.set(queryString, count - 1);
            }
          }

          perTableResolver.get(table)!.resolve();
          perTableResolver.set(table, promiseWithResolvers<void>());
        }

        if (liveQueryUpdatedTables.size > 0) {
          let queryCount = 0;
          for (const table of liveQueryUpdatedTables) {
            queryCount += perTableQueries.get(table)!.size;
          }

          globalThis.PONDER_COMMON.logger.debug({
            msg: "Updated live queries",
            tables: JSON.stringify(Array.from(liveQueryUpdatedTables)),
            query_count: queryCount,
          });
        }

        liveQueryUpdatedTables.clear();
      } else {
        liveQueryUpdatedTables.add(table);
      }
    });
  } else {
    (async () => {
      let client: pg.PoolClient | undefined;

      let hasRegisteredShutdown = false;

      while (globalThis.PONDER_COMMON.apiShutdown.isKilled === false) {
        // biome-ignore lint/suspicious/noAsyncPromiseExecutor: <explanation>
        await new Promise<void>(async (resolve) => {
          try {
            client = await driver.admin.connect();

            if (hasRegisteredShutdown === false) {
              globalThis.PONDER_COMMON.apiShutdown.add(() => {
                client?.release();
                client = undefined;
              });
              hasRegisteredShutdown = true;
            }

            globalThis.PONDER_COMMON.logger.info({
              msg: `Established listen connection for "@ponder/client" middleware`,
            });

            client.on("notification", (notification) => {
              const table = notification.channel.slice(
                "live_query_channel_".length +
                  (globalThis.PONDER_NAMESPACE_BUILD.schema ?? "public")
                    .length +
                  1,
              );

              // Note: only act when the "_ponder_checkpoint" table is updated
              // because tables can be updated multiple times in a single transaction
              // and the notification is only sent once for the entire transaction

              if (table === "_ponder_checkpoint") {
                isLive = true;

                for (const table of liveQueryUpdatedTables) {
                  for (const [queryString] of perTableQueries.get(table)!) {
                    cache.delete(queryString);

                    const count = perTableQueries.get(table)!.get(queryString)!;
                    if (count === 1) {
                      perTableQueries.get(table)!.delete(queryString);
                    } else {
                      perTableQueries.get(table)!.set(queryString, count - 1);
                    }
                  }

                  perTableResolver.get(table)!.resolve();
                  perTableResolver.set(table, promiseWithResolvers<void>());
                }

                if (liveQueryUpdatedTables.size > 0) {
                  let queryCount = 0;
                  for (const table of liveQueryUpdatedTables) {
                    queryCount += perTableQueries.get(table)!.size;
                  }

                  globalThis.PONDER_COMMON.logger.debug({
                    msg: "Updated live queries",
                    tables: JSON.stringify(Array.from(liveQueryUpdatedTables)),
                    query_count: queryCount,
                  });
                }

                liveQueryUpdatedTables.clear();
              } else {
                liveQueryUpdatedTables.add(table);
              }
            });

            client.on("error", async (error) => {
              globalThis.PONDER_COMMON.logger.warn({
                msg: `Failed listen connection for "@ponder/client" middleware`,
                retry_delay: 250,
                error,
              });
              client?.release();
              client = undefined;

              await new Promise((resolve) => setTimeout(resolve, 250));

              resolve();
            });

            for (const table of tables) {
              await client.query(`LISTEN "${getLiveQueryChannelName(table)}"`);
            }
            // Note: Don't use the `getLiveQueryChannelName` function here because we want minimal imports for bundling.
            await client.query(
              `LISTEN "live_query_channel_${globalThis.PONDER_NAMESPACE_BUILD.schema ?? "public"}__ponder_checkpoint"`,
            );
          } catch (error) {
            globalThis.PONDER_COMMON.logger.warn({
              msg: `Failed listen connection for "@ponder/client" middleware`,
              retry_delay: 250,
              error: error as Error,
            });
            client?.release();
            client = undefined;

            await new Promise((resolve) => setTimeout(resolve, 250));

            resolve();
          }
        });
      }
    })();
  }

  const getQueryResult = (query: QueryWithTypings): Promise<QueryResult> => {
    if (driver.dialect === "pglite") {
      return session.prepareQuery(query, undefined, undefined, false).execute();
    } else {
      return globalThis.PONDER_DATABASE.readonlyQB.raw.transaction(
        (tx) => {
          return tx._.session
            .prepareQuery(query, undefined, undefined, false)
            .execute();
        },
        { accessMode: "read only" },
      );
    }
  };

  return createMiddleware(async (c, next) => {
    const crypto = await import(/* webpackIgnore: true */ "node:crypto");
    await parseViewPromise;

    if (c.req.path === "/sql/db") {
      const queryString = c.req.query("sql");
      if (queryString === undefined) {
        return c.text('Missing "sql" query parameter', 400);
      }
      const query = superjson.parse(queryString) as QueryWithTypings;

      try {
        await validateAllowableSQLQuery(query.sql);
      } catch (error) {
        (error as Error).stack = undefined;
        return c.text((error as Error).message, 500);
      }

      const relations = await getSQLQueryRelations(query.sql);
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

      for (const tableName of referencedTables) {
        if (perTableQueries.get(tableName)!.has(queryString)) {
          const count = perTableQueries.get(tableName)!.get(queryString)!;
          perTableQueries.get(tableName)!.set(queryString, count + 1);
        } else {
          perTableQueries.get(tableName)!.set(queryString, 1);
        }
      }

      let resultPromise: Promise<unknown>;

      if (isLive === false) {
        resultPromise = getQueryResult(query);
      } else if (cache.has(queryString)) {
        const resultRef = cache.get(queryString)!.deref();

        if (resultRef === undefined) {
          cache.delete(queryString);
          resultPromise = getQueryResult(query);
          cache.set(queryString, new WeakRef(resultPromise));
        } else {
          resultPromise = resultRef;
        }
      } else {
        resultPromise = getQueryResult(query);
        cache.set(queryString, new WeakRef(resultPromise));
      }

      try {
        return c.json((await resultPromise) as object);
      } catch (error) {
        (error as Error).stack = undefined;
        return c.text((error as Error).message, 500);
      }
    }

    if (c.req.path === "/sql/live") {
      if (isLive === false) {
        return c.text(
          "Live queries are not available until the backfill is complete",
          503,
        );
      }

      if (liveQueryCount >= MAX_LIVE_QUERIES) {
        return c.text("Maximum number of live queries reached", 503);
      }

      liveQueryCount++;

      c.header("Content-Type", "text/event-stream");
      c.header("Cache-Control", "no-cache");
      c.header("Connection", "keep-alive");

      const queryString = c.req.query("sql");
      if (queryString === undefined) {
        return c.text('Missing "sql" query parameter', 400);
      }
      const query = superjson.parse(queryString) as QueryWithTypings;

      try {
        await validateAllowableSQLQuery(query.sql);
      } catch (error) {
        (error as Error).stack = undefined;
        return c.text((error as Error).message, 500);
      }

      const relations = await getSQLQueryRelations(query.sql);
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

      for (const tableName of referencedTables) {
        if (perTableQueries.get(tableName)!.has(queryString)) {
          const count = perTableQueries.get(tableName)!.get(queryString)!;
          perTableQueries.get(tableName)!.set(queryString, count + 1);
        } else {
          perTableQueries.get(tableName)!.set(queryString, 1);
        }
      }

      let result: QueryResult;
      if (cache.has(queryString)) {
        const resultRef = cache.get(queryString)!.deref();

        if (resultRef === undefined) {
          cache.delete(queryString);
          const resultPromise = getQueryResult(query);
          cache.set(queryString, new WeakRef(resultPromise));
          result = await resultPromise;
        } else {
          result = await resultRef;
        }
      } else {
        const resultPromise = getQueryResult(query);
        cache.set(queryString, new WeakRef(resultPromise));
        result = await resultPromise;
      }

      let resultHash = crypto
        .createHash("sha256")
        // @ts-ignore
        .update(JSON.stringify(result.rows))
        .digest("hex")
        .slice(0, 10);

      return streamSSE(c, async (stream) => {
        stream.onAbort(() => {
          liveQueryCount--;

          for (const table of referencedTables) {
            const count = perTableQueries.get(table)!.get(queryString)!;
            if (count === 1) {
              perTableQueries.get(table)!.delete(queryString);
            } else {
              perTableQueries.get(table)!.set(queryString, count - 1);
            }
          }
        });

        await stream.writeSSE({ data: JSON.stringify(result) });

        while (stream.closed === false && stream.aborted === false) {
          await Promise.race(
            Array.from(referencedTables).map(
              (relation) => perTableResolver.get(relation)!.promise,
            ),
          );

          try {
            let resultPromise: Promise<unknown>;
            if (cache.has(queryString)) {
              const resultRef = cache.get(queryString)!.deref();

              if (resultRef === undefined) {
                cache.delete(queryString);
                resultPromise = getQueryResult(query);
                cache.set(queryString, new WeakRef(resultPromise));
              } else {
                resultPromise = resultRef;
              }
            } else {
              resultPromise = getQueryResult(query);
              cache.set(queryString, new WeakRef(resultPromise));
            }

            const result = await resultPromise;

            const _resultHash = crypto
              .createHash("sha256")
              // @ts-ignore
              .update(JSON.stringify(result.rows))
              .digest("hex")
              .slice(0, 10);

            if (_resultHash === resultHash) continue;
            resultHash = _resultHash;

            // @ts-ignore
            await stream.writeSSE({ data: JSON.stringify(result) });
          } catch {
            stream.abort();
          }
        }
      });
    }

    return next();
  });
};
