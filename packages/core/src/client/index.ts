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
    // TODO(kyle) method?

    if (c.req.path === "/client/db") {
      const body = await c.req.json();

      // @ts-ignore
      const res = await session
        .prepareQuery(
          {
            sql: body.sql,
            params: body.params,
            // @ts-ignore
            typings: body.typings,
          },
          undefined,
          undefined,
          body.method === "all",
        )
        .execute();

      // @ts-ignore
      return c.json({ rows: res.rows.map((row) => Object.values(row)) });
    }

    if (c.req.path === "/client/live") {
      c.header("Content-Type", "text/event-stream");
      c.header("Cache-Control", "no-cache");
      c.header("Connection", "keep-alive");

      await queryPromise;

      return streamSSE(
        c,
        async (stream) => {
          stream.onAbort(() => {
            stream.close();
          });

          while (stream.closed === false) {
            const query = JSON.parse(c.req.query("query")!) as QueryWithTypings;

            const result = await session
              .prepareQuery(query, undefined, undefined, false)
              .execute();

            // TODO(kyle) close stream if unsuccessful
            await stream.writeSSE({
              // @ts-ignore
              data: JSON.stringify({ rows: result.rows }),
            });

            await statusResolver.promise;
          }
        },
        async () => {
          // TODO(kyle) send error to client?
          // TODO(kyle) log error
        },
      );
    }

    return next();
  });
};
