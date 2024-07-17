import { ponder } from "@/generated";
import { count, eq, or } from "@ponder/core";
import { getAddress } from "viem";

ponder.get("/count", async (c) => {
  const result = await c.db.select({ count: count() }).from(c.tables.SwapEvent);

  return c.text(String(result[0]?.count ?? 0));
});

ponder.get("/user-count/:address", async (c) => {
  const account = getAddress(c.req.param("address"));
  const { SwapEvent } = c.tables;

  const result = await c.db
    .select({ count: count() })
    .from(c.tables.SwapEvent)
    .where(or(eq(SwapEvent.payer, account), eq(SwapEvent.recipient, account)));

  return c.text(String(result[0]?.count ?? 0));
});
