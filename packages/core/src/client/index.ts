import type { Schema } from "@/internal/types.js";
import type { ReadonlyDrizzle } from "@/types/db.js";
import { PGlite } from "@electric-sql/pglite";
import { promiseWithResolvers } from "@ponder/common";
import type { QueryWithTypings } from "drizzle-orm";
import type { PgSession } from "drizzle-orm/pg-core";
import { createMiddleware } from "hono/factory";
import { streamSSE } from "hono/streaming";

export const client = ({ db }: { db: ReadonlyDrizzle<Schema> }) => {
  // @ts-ignore
  const session: PgSession = db._.session;
  const listenConnection = global.PONDER_LISTEN_CONNECTION;
  let statusResolver = promiseWithResolvers<void>();

  let queryPromise: Promise<any>;

  if (listenConnection instanceof PGlite) {
    queryPromise = listenConnection.query("LISTEN status_update_channel");

    listenConnection.onNotification(() => {
      statusResolver.resolve();
      statusResolver = promiseWithResolvers();
    });
  } else {
    queryPromise = listenConnection.query("LISTEN status_update_channel");

    listenConnection.on("notification", () => {
      statusResolver.resolve();
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
      const queryString = c.req.query("sql");
      if (queryString === undefined) {
        return c.text('Missing "sql" query parameter', 400);
      }
      const query = JSON.parse(queryString) as QueryWithTypings;

      // TODO(kyle) live queries only availble in realtime mode

      c.header("Content-Type", "text/event-stream");
      c.header("Cache-Control", "no-cache");
      c.header("Connection", "keep-alive");

      await queryPromise;

      return streamSSE(c, async (stream) => {
        while (stream.closed === false) {
          try {
            const result = await session
              .prepareQuery(query, undefined, undefined, false)
              .execute();
            await stream.writeSSE({
              data: JSON.stringify({ status: "success", result }),
            });
          } catch (error) {
            await stream.writeSSE({
              data: JSON.stringify({
                status: "error",
                error: (error as Error).message,
              }),
            });
          }
          await statusResolver.promise;
        }
      });
    }

    return next();
  });
};
