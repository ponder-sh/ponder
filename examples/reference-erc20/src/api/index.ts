import { Account } from "ponder:db";
import { ponder } from "ponder:virtual";
import { graphql } from "@ponder/core";

// write file
ponder.use("/graphql", graphql());

ponder.get("/router", async (c) => {
  const db = c.get("db");

  const account = await db.select().from(Account);

  if (account.length === 0) {
    return c.text("Not Found!");
  } else {
    return c.text(`Balance: ${account[0]!.balance.toString()}`);
  }
});
