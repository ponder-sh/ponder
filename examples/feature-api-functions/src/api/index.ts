import { account, transferEvent } from "ponder:schema";
import { ponder } from "@/generated";
import { count, desc, eq, graphql, or, replaceBigInts } from "ponder";
import { formatEther, getAddress } from "viem";

ponder.use("/graphql", graphql());

ponder.get("/count", async (c) => {
  const result = await c.db.select({ count: count() }).from(transferEvent);

  if (result.length === 0) return c.text("0");
  return c.text(String(result[0]!.count));
});

ponder.get("/count/:address", async (c) => {
  const account = getAddress(c.req.param("address"));

  const result = await c.db
    .select({ count: count() })
    .from(transferEvent)
    .where(or(eq(transferEvent.from, account), eq(transferEvent.to, account)));

  if (result.length === 0) return c.text("0");
  return c.text(String(result[0]!.count));
});

ponder.get("/whale-transfers", async (c) => {
  // Top 10 transfers from whale accounts
  const result = await c.db
    .select({
      sender: account.address,
      senderBalance: account.balance,
      amount: transferEvent.amount,
    })
    .from(transferEvent)
    .innerJoin(account, eq(transferEvent.from, account.address))
    .orderBy(desc(account.balance))
    .limit(10);

  if (result.length === 0) return c.text("Not found", 500);
  return c.json(replaceBigInts(result, (b) => formatEther(b)));
});
