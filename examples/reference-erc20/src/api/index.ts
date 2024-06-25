import { Account, eq } from "ponder:db";
import { ponder } from "@/generated";
import { graphql } from "@ponder/core";
import { zeroAddress } from "viem";

// write file
ponder.use("/graphql", graphql());

ponder.get("/router", async (c) => {
  const db = c.get("db");

  const account = await db
    .select()
    .from(Account)
    .where(eq(Account.id, zeroAddress));

  if (account.length === 0) {
    return c.text("Not Found!");
  } else {
    return c.text(`Balance: ${account[0]!.id.toString()}`);
  }
});
