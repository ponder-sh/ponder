import { ponder } from "@/generated";
import { graphql, replaceBigInts } from "@ponder/core";
import { count, desc, eq, or } from "drizzle-orm";
import { formatEther, getAddress } from "viem";
import * as offchainSchema from "../../ponder.offchain";

ponder.use("/graphql", graphql());

ponder.get("/count", async (c) => {
  const result = await c.db
    .select({ count: count() })
    .from(c.tables.TransferEvent);

  if (result.length === 0) return c.text("0");
  return c.text(String(result[0]!.count));
});

ponder.get("/count/:address", async (c) => {
  const account = getAddress(c.req.param("address"));
  const { TransferEvent } = c.tables;

  const result = await c.db
    .select({ count: count() })
    .from(c.tables.TransferEvent)
    .where(
      or(eq(TransferEvent.fromId, account), eq(TransferEvent.toId, account)),
    );

  if (result.length === 0) return c.text("0");
  return c.text(String(result[0]!.count));
});

ponder.get("/whale-transfers", async (c) => {
  const { TransferEvent, Account } = c.tables;

  // Top 10 transfers from whale accounts
  const result = await c.db
    .select({
      sender: Account.id,
      senderBalance: Account.balance,
      amount: TransferEvent.amount,
    })
    .from(TransferEvent)
    .innerJoin(Account, eq(TransferEvent.fromId, Account.id))
    .orderBy(desc(Account.balance))
    .limit(10);

  if (result.length === 0) return c.text("Not found", 500);
  return c.json(replaceBigInts(result, (b) => formatEther(b)));
});

ponder.get("/register/:address", async (c) => {
  const account = getAddress(c.req.param("address"));
  await c.db.insert(offchainSchema.metadata).values({ account });

  return c.text("Success", 200);
});

ponder.get("/user-transfers", async (c) => {
  // Top 20 largest transfers to registered users
  const result = await c.db
    .select({
      amount: c.tables.TransferEvent.amount,
      account: offchainSchema.metadata.account,
    })
    .from(c.tables.TransferEvent)
    .innerJoin(
      offchainSchema.metadata,
      eq(c.tables.TransferEvent.toId, offchainSchema.metadata.account),
    )
    .orderBy(desc(c.tables.TransferEvent.amount))
    .limit(20);

  return c.json(replaceBigInts(result, (b) => formatEther(b)));
});
