import { Account, desc } from "ponder:db";
import { ponder } from "@/generated";
import { graphql } from "@ponder/core";
import { formatEther } from "viem";

// write file
ponder.use("/graphql", graphql());

ponder.get("/big", async (c) => {
  const db = c.get("db");

  const account = await db
    .select({ balance: Account.balance })
    .from(Account)
    .orderBy(desc(Account.balance))
    .limit(1);

  if (account.length === 0) {
    return c.text("Not Found!");
  } else {
    return c.text(`Balance: ${formatEther(account[0]!.balance)}`);
  }
});
