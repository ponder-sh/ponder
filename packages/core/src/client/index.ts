import type { ReadonlyDrizzle, Schema } from "@/drizzle/index.js";
import { createMiddleware } from "hono/factory";

export const client = ({ db }: { db: ReadonlyDrizzle<Schema> }) => {
  return createMiddleware(async (c, next) => {
    if (c.req.path !== "/client") {
      return next();
    }

    const body = await c.req.json();

    // @ts-ignore
    const res = await db._.session
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
  });
};
