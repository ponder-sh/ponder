import { ponder } from "@/generated";
import { count, desc, eq, graphql, or, replaceBigInts } from "@ponder/core";
import { formatEther, getAddress } from "viem";

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
      amount: TransferEvent.amount,
      senderBalance: Account.balance,
    })
    .from(TransferEvent)
    .innerJoin(Account, eq(TransferEvent.fromId, Account.id))
    .orderBy(desc(Account.balance))
    .limit(10);

  if (result.length === 0) return c.text("Not found", 500);
  return c.json(replaceBigInts(result, (b) => formatEther(b)));
});
