import { getPonderCheckpointTable } from "@/database/index.js";
import { getLiveQueryChannelName } from "@/drizzle/index.js";
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
import { type QueryWithTypings, getTableName, isTable } from "drizzle-orm";
import type { PgSession } from "drizzle-orm/pg-core";
import { createMiddleware } from "hono/factory";
import { streamSSE } from "hono/streaming";
import type * as pg from "pg";
import superjson from "superjson";

type QueryString = string;
type QueryResult = unknown;

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
  const tableNames = new Set(tables.map(getTableName));
  const PONDER_CHECKPOINT = getPonderCheckpointTable(
    globalThis.PONDER_NAMESPACE_BUILD.schema,
  );

  // @ts-ignore
  const session: PgSession = db._.session;
  const driver = globalThis.PONDER_DATABASE.driver;

  // TODO(kyle) parse views
  const cache = new Map<QueryString, WeakRef<Promise<unknown>>>();
  /** Tables that have updated in the current transaction. */
  const liveQueryUpdatedTables = new Set<string>();
  const perTableResolver = new Map<string, PromiseWithResolvers<void>>();
  const perTableQueries = new Map<string, Map<QueryString, number>>();
  /** `true` if the app is indexing live blocks. */
  let isLive = false;

  for (const table of tableNames) {
    perTableResolver.set(table, promiseWithResolvers<void>());
    perTableQueries.set(table, new Map());
  }

  // TODO(kyle) query db to determine if the app is live

  if (driver.dialect === "pglite") {
    // driver.instance.query(`LISTEN "${channel}"`).then(() => {
    //   driver.instance.onNotification(() => {
    //     // Clear cache on status change
    //     cache.clear();
    //     statusResolver.resolve();
    //     statusResolver = promiseWithResolvers<void>();
    //   });
    // });
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
                    // TODO(kyle) decrement count `perTableQueries`
                  }

                  perTableResolver.get(table)!.resolve();
                  perTableResolver.set(table, promiseWithResolvers<void>());
                }

                if (liveQueryUpdatedTables.size > 0) {
                  globalThis.PONDER_COMMON.logger.info({
                    msg: "Received live query table update notification",
                    tables: JSON.stringify(Array.from(liveQueryUpdatedTables)),
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
            await client.query(
              `LISTEN "${getLiveQueryChannelName(PONDER_CHECKPOINT)}"`,
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

      for (const relation of relations) {
        if (tableNames.has(relation) === false) continue;

        if (perTableQueries.get(relation)!.has(queryString)) {
          const count = perTableQueries.get(relation)!.get(queryString)!;
          perTableQueries.get(relation)!.set(queryString, count + 1);
        } else {
          perTableQueries.get(relation)!.set(queryString, 1);
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

      c.header("Content-Type", "text/event-stream");
      c.header("Cache-Control", "no-cache");
      c.header("Connection", "keep-alive");

      const queryString = c.req.query("sql");
      if (queryString === undefined) {
        return c.text('Missing "sql" query parameter', 400);
      }
      const query = superjson.parse(queryString) as QueryWithTypings;

      // TODO(kyle) normalize query string

      try {
        await validateAllowableSQLQuery(query.sql);
      } catch (error) {
        (error as Error).stack = undefined;
        return c.text((error as Error).message, 500);
      }

      const relations = await getSQLQueryRelations(query.sql);

      for (const relation of relations) {
        if (tableNames.has(relation) === false) continue;

        if (perTableQueries.get(relation)!.has(queryString)) {
          const count = perTableQueries.get(relation)!.get(queryString)!;
          perTableQueries.get(relation)!.set(queryString, count + 1);
        } else {
          perTableQueries.get(relation)!.set(queryString, 1);
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
          // TODO(kyle) decrement count `perTableQueries`
        });

        await stream.writeSSE({ data: "" });

        while (stream.closed === false && stream.aborted === false) {
          await Promise.race(
            Array.from(relations).map(
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

            // TODO(kyle) handle error

            const result = await resultPromise;

            const _resultHash = crypto
              .createHash("sha256")
              // @ts-ignore
              .update(JSON.stringify(result.rows))
              .digest("hex")
              .slice(0, 10);

            if (_resultHash === resultHash) continue;
            resultHash = _resultHash;
            await stream.writeSSE({ data: "" });
          } catch {}
          // TODO(kyle) max refresh rate
        }
      });
    }

    return next();
  });
};
