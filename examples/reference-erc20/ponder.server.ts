import { hono } from "@/generated";
import { graphQLMiddleware } from "@ponder/core";

hono.use("/graphql", graphQLMiddleware());

hono.get("/router", async (c) => {
  const db = c.get("db");
  const account = await db.Account.findUnique({
    id: "0x0000000000000000000000000000000000000000",
  });

  if (account === null) {
    return c.text("Not Found!");
  } else {
    return c.text(`Balance: ${account.balance.toString()}`);
  }
});
