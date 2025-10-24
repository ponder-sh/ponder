import { getPonderCheckpointTable } from "@/database/index.js";
import { getLiveQueryChannelName } from "@/drizzle/index.js";
import type { Schema } from "@/internal/types.js";
import type { ReadonlyDrizzle } from "@/types/db.js";
import { promiseWithResolvers } from "@/utils/promiseWithResolvers.js";
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

  // TODO(kyle) query db on startup to determine if the app is live
  /** `true` if the app is indexing live blocks. */
  let isLive = false;
  /** Tables that have updated in the current transaction. */
  const liveQueryUpdatedTables = new Set<string>();
  const cache = new Map<QueryString, WeakRef<Promise<unknown>>>();
  const liveQueryRegistry = new Map<
    QueryString,
    {
      query: QueryWithTypings;
      references: string[];
      result: unknown;
      streams: unknown[];
      count: number;
    }
  >();
  /** Relation name => (query string => count) */
  const queryRelationMap = new Map<string, Map<QueryString, number>>();

  for (const table of tableNames) {
    queryRelationMap.set(table, new Map());
  }

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
                // Clear cache on status change
                cache.clear();

                for (const table of liveQueryUpdatedTables) {
                  for (const [queryString] of queryRelationMap.get(table)!) {
                    const liveQuery = liveQueryRegistry.get(queryString)!;
                    // TODO(kyle) notify to re-execute query, compare results
                  }
                }

                if (liveQueryUpdatedTables.size > 0) {
                  globalThis.PONDER_COMMON.logger.debug({
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

  return createMiddleware(async (c, next) => {
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

      // TODO(kyle) don't use cache for non-live queries

      let resultPromise: Promise<unknown>;

      const _resultPromise = cache.get(queryString)?.deref() ?? undefined;
      if (_resultPromise === undefined) {
        cache.delete(queryString);

        const pwr = promiseWithResolvers<unknown>();
        cache.set(queryString, new WeakRef(pwr.promise));
        resultPromise = pwr.promise;

        if (driver.dialect === "pglite") {
          session
            .prepareQuery(query, undefined, undefined, false)
            .execute()
            .then(pwr.resolve)
            .catch(pwr.reject);
        } else {
          globalThis.PONDER_DATABASE.readonlyQB.raw
            .transaction(
              (tx) => {
                return tx._.session
                  .prepareQuery(query, undefined, undefined, false)
                  .execute();
              },
              { accessMode: "read only" },
            )
            .then(pwr.resolve)
            .catch(pwr.reject);
        }
      } else {
        resultPromise = _resultPromise;
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

      try {
        await validateAllowableSQLQuery(query.sql);
      } catch (error) {
        (error as Error).stack = undefined;
        return c.text((error as Error).message, 500);
      }

      if (liveQueryRegistry.has(queryString)) {
        // TODO(kyle) add stream to registry
      } else {
        const relations = await getSQLQueryRelations(query.sql);

        for (const relation of relations) {
          if (tableNames.has(relation) === false) continue;

          if (queryRelationMap.get(relation)!.has(queryString)) {
            const count = queryRelationMap.get(relation)!.get(queryString)!;
            queryRelationMap.get(relation)!.set(queryString, count + 1);
          } else {
            queryRelationMap.get(relation)!.set(queryString, 1);
          }
        }

        // TODO(kyle) query initial result
      }

      return streamSSE(c, async (stream) => {
        stream.onAbort(() => {
          // TODO(kyle) remove stream from registry
          // TODO(kyle) remove from queryRelationMap
        });

        // TODO(kyle) can we re-use the cache?

        // while (stream.closed === false && stream.aborted === false) {
        //   try {
        //     await stream.writeSSE({ data: "" });
        //   } catch {}
        //   await statusResolver.promise;
        // }
      });
    }

    return next();
  });
};
