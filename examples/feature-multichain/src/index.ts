import { ponder } from "@/generated";
import { account } from "../ponder.schema";

ponder.on("weth9:Deposit", async ({ event, context }) => {
  await context.db
    .upsert(account, { address: event.args.dst })
    .insert({ balance: event.args.wad })
    .update((row) => ({ balance: row.balance + event.args.wad }));
});
