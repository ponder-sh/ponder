import type { Drizzle } from "@/drizzle/index.js";
import { createMiddleware } from "hono/factory";

export const client = () => {
  return createMiddleware(async (c) => {
    const body = await c.req.json();

    const db = c.get("db") as Drizzle;

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

    return c.json({ rows: [] });

    // @ts-ignore
    // return { rows: res.rows.map((row) => Object.values(row)) };
  });
};
