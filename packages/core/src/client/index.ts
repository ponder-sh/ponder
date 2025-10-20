import type { Schema } from "@/internal/types.js";
import type { ReadonlyDrizzle } from "@/types/db.js";
import { promiseWithResolvers } from "@/utils/promiseWithResolvers.js";
import type { QueryWithTypings } from "drizzle-orm";
import type { PgSession } from "drizzle-orm/pg-core";
import { createMiddleware } from "hono/factory";
import { streamSSE } from "hono/streaming";
import type * as pg from "pg";
import superjson from "superjson";
import { validateQuery } from "./parse.js";

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

  // @ts-ignore
  const session: PgSession = db._.session;
  const driver = globalThis.PONDER_DATABASE.driver;
  let statusResolver = promiseWithResolvers<void>();

  const channel = `${globalThis.PONDER_NAMESPACE_BUILD.schema}_status_channel`;

  const cache = new Map<string, WeakRef<Promise<unknown>>>();

  if (driver.dialect === "pglite") {
    driver.instance.query(`LISTEN "${channel}"`).then(() => {
      driver.instance.onNotification(() => {
        // Clear cache on status change
        cache.clear();
        statusResolver.resolve();
        statusResolver = promiseWithResolvers<void>();
      });
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

            client.on("notification", () => {
              // Clear cache on status change
              cache.clear();
              statusResolver.resolve();
              statusResolver = promiseWithResolvers<void>();
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

            await client.query(`LISTEN "${channel}"`);
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
        await validateQuery(query.sql);
      } catch (error) {
        (error as Error).stack = undefined;
        return c.text((error as Error).message, 500);
      }

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
      c.header("Content-Type", "text/event-stream");
      c.header("Cache-Control", "no-cache");
      c.header("Connection", "keep-alive");

      return streamSSE(c, async (stream) => {
        while (stream.closed === false && stream.aborted === false) {
          try {
            await stream.writeSSE({ data: "" });
          } catch {}
          await statusResolver.promise;
        }
      });
    }

    return next();
  });
};
