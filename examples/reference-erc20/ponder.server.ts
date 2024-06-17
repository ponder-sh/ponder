import { hono } from "@/generated";
import { graphQLMiddleware } from "@ponder/core";
import { hexToBytes, zeroAddress } from "viem";

hono.use("/graphql", graphQLMiddleware());

hono.get("/router", async (c) => {
  const db = c.get("db");

  const account = await db.query<{ balance: string }>(
    `SELECT * FROM "Account" WHERE id = ${Buffer.from(
      hexToBytes(zeroAddress),
    )}`,
  );

  if (account === null) {
    return c.text("Not Found!");
  } else {
    return c.text(`Balance: ${account.rows[0]?.balance.toString() ?? "0"}`);
  }
});
