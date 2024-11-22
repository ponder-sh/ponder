import { db } from "ponder:api";
import { account, transferEvent } from "ponder:schema";
import { Hono } from "hono";
import { count, desc, eq, graphql, or, replaceBigInts } from "ponder";
import { formatEther, getAddress } from "viem";

export default new Hono()
  .use("/graphql", graphql())
  .get("/count/:address", async (c) => {
    const account = getAddress(c.req.param("address"));

    const result = await db
      .select({ count: count() })
      .from(transferEvent)
      .where(
        or(eq(transferEvent.from, account), eq(transferEvent.to, account)),
      );

    if (result.length === 0) return c.text("0");
    return c.text(String(result[0]!.count));
  })
  .get("/count", async (c) => {
    const result = await db.select({ count: count() }).from(transferEvent);

    if (result.length === 0) return c.text("0");
    return c.text(String(result[0]!.count));
  })
  .get("/whale-transfers", async (c) => {
    // Top 10 transfers from whale accounts
    const result = await db
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
