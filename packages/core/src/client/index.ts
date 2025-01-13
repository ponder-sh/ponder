import type { Schema } from "@/internal/types.js";
import type { ReadonlyDrizzle } from "@/types/db.js";
import { promiseWithResolvers } from "@ponder/common";
import type { QueryWithTypings } from "drizzle-orm";
import { type PgSession, pgTable } from "drizzle-orm/pg-core";
import { createMiddleware } from "hono/factory";
import { streamSSE } from "hono/streaming";

const status = pgTable("_ponder_status", (t) => ({
  chainId: t.bigint({ mode: "number" }).primaryKey(),
  blockNumber: t.bigint({ mode: "number" }),
  blockTimestamp: t.bigint({ mode: "number" }),
  ready: t.boolean().notNull(),
}));

/**
 * Middleware for `@ponder/client`.
 *
 * @param db - Drizzle database instance
 *
 * @example
 * ```ts
 * import { db } from "ponder:api";
 * import { Hono } from "hono";
 * import { client } from "ponder";
 *
 * const app = new Hono();
 *
 * app.use(client({ db }));
 *
 * export default app;
 * ```
 */
export const client = ({ db }: { db: ReadonlyDrizzle<Schema> }) => {
  // @ts-ignore
  const session: PgSession = db._.session;
  const driver = global.PONDER_DATABASE.driver;
  let statusResolver = promiseWithResolvers<(typeof status.$inferSelect)[]>();

  const channel = `${global.PONDER_NAMESPACE_BUILD}_status_channel`;

  if ("instance" in driver) {
    driver.instance.query(`LISTEN ${channel}`).then(() => {
      driver.instance.onNotification(async () => {
        const result = await db.select().from(status);
        statusResolver.resolve(result);
        statusResolver = promiseWithResolvers();
      });
    });
  } else {
    const pool = driver.internal;

    const connectAndListen = async () => {
      driver.listen = await pool.connect();

      await driver.listen.query(`LISTEN ${channel}`);

      driver.listen.on("error", async () => {
        driver.listen?.release();
        connectAndListen();
      });

      driver.listen.on("notification", async () => {
        const result = await db.select().from(status);
        statusResolver.resolve(result);
        statusResolver = promiseWithResolvers();
      });
    };

    connectAndListen();
  }

  return createMiddleware(async (c, next) => {
    if (c.req.path === "/client/db") {
      const queryString = c.req.query("sql");
      if (queryString === undefined) {
        return c.text('Missing "sql" query parameter', 400);
      }
      const query = JSON.parse(queryString) as QueryWithTypings;

      try {
        const result = await session
          .prepareQuery(query, undefined, undefined, false)
          .execute();

        return c.json(result as object);
      } catch (error) {
        (error as Error).stack = undefined;
        return c.text((error as Error).message, 500);
      }
    }

    if (c.req.path === "/client/live") {
      // TODO(kyle) live queries only availble in realtime mode

      c.header("Content-Type", "text/event-stream");
      c.header("Cache-Control", "no-cache");
      c.header("Connection", "keep-alive");

      let statusResult = await db.select().from(status);

      return streamSSE(c, async (stream) => {
        while (stream.closed === false && stream.aborted === false) {
          try {
            await stream.writeSSE({
              data: JSON.stringify({ status: "success", result: statusResult }),
            });
          } catch {}
          statusResult = await statusResolver.promise;
        }
      });
    }

    return next();
  });
};
