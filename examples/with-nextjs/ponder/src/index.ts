import { ponder } from "ponder:registry";
import schema from "ponder:schema";

ponder.on("weth9:Deposit", async ({ event, context }) => {
  await context.db.insert(schema.depositEvent).values({
    id: event.log.id,
    account: event.args.dst,
    amount: event.args.wad,
    timestamp: Number(event.block.timestamp),
  });
});
