import { account } from "ponder:schema";
import { ponder } from "@/generated";

ponder.on("weth9:Deposit", async ({ event, context }) => {
  await context.db
    .insert(account)
    .values({ address: event.args.dst, balance: event.args.wad })
    .onConflictDoUpdate((row) => ({ balance: row.balance + event.args.wad }));
});
