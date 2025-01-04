import type { ReadonlyDrizzle, Schema } from "@/drizzle/index.js";
import { hash } from "@/utils/hash.js";
import type { QueryWithTypings } from "drizzle-orm";
import type { PgSession } from "drizzle-orm/pg-core";
import { createMiddleware } from "hono/factory";
import { streamSSE } from "hono/streaming";

const POLL_INTERVAL = 500;

export const client = ({ db }: { db: ReadonlyDrizzle<Schema> }) => {
  let id = 0;

  return createMiddleware(async (c, next) => {
    // @ts-ignore
    const session: PgSession = db._.session;
    const liveQueries = new Map<
      number,
      {
        queryHash: string;
        resultHash: string;
      }
    >();

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

      const streamId = id++;

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

            // no-op if result is the same

            if (
              liveQueries.has(streamId) &&
              // @ts-ignore
              hash(result.rows) === liveQueries.get(streamId)!.resultHash
            ) {
              await stream.sleep(POLL_INTERVAL);
              continue;
            }

            liveQueries.set(streamId, {
              // @ts-ignore
              queryHash: hash(query),
              // @ts-ignore
              resultHash: hash(result.rows),
            });

            // TODO(kyle) close stream if unsuccessful
            await stream.writeSSE({
              data: JSON.stringify({
                // @ts-ignore
                rows: result.rows,
              }),
            });

            await stream.sleep(POLL_INTERVAL);
          }

          liveQueries.delete(streamId);
        },
        async () => {
          // TODO(kyle) send error to client?
          // TODO(kyle) log error
        },
      );
    }

    // Live query event loop

    return next();
  });
};
