import { ponder } from "@/generated";
import { replaceBigInts } from "@ponder/core";
import { count, desc, eq, or } from "@ponder/core/db";
import { formatEther, getAddress } from "viem";
import { account, metadata, transferEvent } from "../../ponder.schema";

// ponder.use("/graphql", graphql());

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

ponder.get("/register/:address", async (c) => {
  const account = getAddress(c.req.param("address"));
  await c.db.insert(metadata).values({ account });

  return c.text("Success", 200);
});

ponder.get("/user-transfers", async (c) => {
  // Top 20 largest transfers to registered users
  const result = await c.db
    .select({
      amount: transferEvent.amount,
      account: metadata.account,
    })
    .from(transferEvent)
    .innerJoin(metadata, eq(transferEvent.to, metadata.account))
    .orderBy(desc(transferEvent.amount))
    .limit(20);

  return c.json(replaceBigInts(result, (b) => formatEther(b)));
});
