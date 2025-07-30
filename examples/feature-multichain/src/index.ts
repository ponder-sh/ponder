import { ponder } from "ponder:registry";
import { account } from "ponder:schema";

ponder.on("weth9:Deposit", async ({ event, context }) => {
  await new Promise((resolve) => setTimeout(resolve, 3));

  await context.db
    .insert(account)
    .values({ address: event.args.dst, balance: event.args.wad })
    .onConflictDoUpdate((row) => ({ balance: row.balance + event.args.wad }));
});
