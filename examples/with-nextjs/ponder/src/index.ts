import schema from "ponder:schema";
import { ponder } from "@/generated";

ponder.on("WETH:Deposit", async ({ event, context }) => {
  await context.db.insert(schema.depositEvent).values({
    id: event.log.id,
    account: event.args.dst,
    amount: event.args.wad,
    timestamp: Number(event.block.timestamp),
  });
});
