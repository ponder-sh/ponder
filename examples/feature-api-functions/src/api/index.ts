import { ponder } from "@/generated";
import { replaceBigInts } from "@ponder/core";
import { count, desc, eq, or } from "@ponder/core/db";
import { formatEther, getAddress } from "viem";
import * as schema from "../../ponder.schema";

// ponder.use("/graphql", graphql());

ponder.get("/count", async (c) => {
  const result = await c.db
    .select({ count: count() })
    .from(schema.transferEvent);

  if (result.length === 0) return c.text("0");
  return c.text(String(result[0]!.count));
});

ponder.get("/count/:address", async (c) => {
  const account = getAddress(c.req.param("address"));

  const result = await c.db
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

ponder.get("/whale-transfers", async (c) => {
  // Top 10 transfers from whale accounts
  const result = await c.db
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

ponder.get("/register/:address", async (c) => {
  const account = getAddress(c.req.param("address"));
  await c.db.insert(schema.metadata).values({ account });

  return c.text("Success", 200);
});

ponder.get("/user-transfers", async (c) => {
  // Top 20 largest transfers to registered users
  const result = await c.db
    .select({
      amount: schema.transferEvent.amount,
      account: schema.metadata.account,
    })
    .from(schema.transferEvent)
    .innerJoin(
      schema.metadata,
      eq(schema.transferEvent.to, schema.metadata.account),
    )
    .orderBy(desc(schema.transferEvent.amount))
    .limit(20);

  return c.json(replaceBigInts(result, (b) => formatEther(b)));
});
