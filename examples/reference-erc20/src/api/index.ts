import { ponder } from "@/generated";
import { desc, graphql } from "@ponder/core";
import { formatEther } from "viem";

ponder.use("/graphql", graphql()).get("/big", async (c) => {
  const { Account } = c.tables;

  const account = await c.db
    //  ^?
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
