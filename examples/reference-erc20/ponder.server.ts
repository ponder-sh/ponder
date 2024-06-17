import { hono } from "@/generated";
import { graphQLMiddleware } from "@ponder/core";

hono.use("/graphql", graphQLMiddleware());

hono.get("/router", async (c) => {
  const db = c.get("db");

  const account = await db.query<{ balance: bigint }>(
    `SELECT * FROM "Account" LIMIT 1`,
  );

  if (account.rows.length === 0) {
    return c.text("Not Found!");
  } else {
    return c.text(`Balance: ${account.rows[0]!.balance.toString()}`);
  }
});
