import { db } from "ponder:api";
import schema from "ponder:schema";
import { Hono } from "hono";
import { count, desc, eq, graphql, or, replaceBigInts } from "ponder";
import { formatEther, getAddress } from "viem";

const app = new Hono();

app.use("/graphql", graphql({ db, schema }));

app.get("/count", async (c) => {
  const result = await db.select({ count: count() }).from(schema.transferEvent);

  if (result.length === 0) return c.text("0");
  return c.text(String(result[0]!.count));
});

app.get("/count/:address", async (c) => {
  const account = getAddress(c.req.param("address"));

  const result = await db
    .select({ count: count() })
    .from(schema.transferEvent)
    .where(
      or(
        eq(schema.transferEvent.from, account),
        eq(schema.transferEvent.to, account),
      ),
    );

  if (result.length === 0) return c.text("0");
  return c.text(String(result[0]!.count));
});

app.get("/whale-transfers", async (c) => {
  // Top 10 transfers from whale accounts
  const result = await db
    .select({
      sender: schema.account.address,
      senderBalance: schema.account.balance,
      amount: schema.transferEvent.amount,
    })
    .from(schema.transferEvent)
    .innerJoin(
      schema.account,
      eq(schema.transferEvent.from, schema.account.address),
    )
    .orderBy(desc(schema.account.balance))
    .limit(10);

  if (result.length === 0) return c.text("Not found", 500);
  return c.json(replaceBigInts(result, (b) => formatEther(b)));
});

export default app;
