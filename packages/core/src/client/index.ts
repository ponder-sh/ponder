import type { Schema } from "@/internal/types.js";
import type { ReadonlyDrizzle } from "@/types/db.js";
import { PGlite } from "@electric-sql/pglite";
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

export const client = ({ db }: { db: ReadonlyDrizzle<Schema> }) => {
  // @ts-ignore
  const session: PgSession = db._.session;
  const listenConnection = global.PONDER_LISTEN_CONNECTION;
  let statusResolver = promiseWithResolvers<(typeof status.$inferSelect)[]>();

  let queryPromise: Promise<any>;

  if (listenConnection instanceof PGlite) {
    queryPromise = listenConnection.query("LISTEN status_update_channel");

    listenConnection.onNotification(async () => {
      const result = await db.select().from(status);
      statusResolver.resolve(result);
      statusResolver = promiseWithResolvers();
    });
  } else {
    queryPromise = listenConnection.query("LISTEN status_update_channel");

    listenConnection.on("notification", async () => {
      const result = await db.select().from(status);
      statusResolver.resolve(result);
      statusResolver = promiseWithResolvers();
    });
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
        return c.text((error as Error).message, 500);
      }
    }

    if (c.req.path === "/client/live") {
      // TODO(kyle) live queries only availble in realtime mode

      c.header("Content-Type", "text/event-stream");
      c.header("Cache-Control", "no-cache");
      c.header("Connection", "keep-alive");

      await queryPromise;

      let statusResult = await db.select().from(status);

      return streamSSE(c, async (stream) => {
        while (stream.closed === false) {
          try {
            await stream.writeSSE({
              data: JSON.stringify({ status: "success", result: statusResult }),
            });
          } catch (error) {
            await stream.writeSSE({
              data: JSON.stringify({
                status: "error",
                error: (error as Error).message,
              }),
            });
          }
          statusResult = await statusResolver.promise;
        }
      });
    }

    return next();
  });
};
