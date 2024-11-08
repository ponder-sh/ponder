import { ponder } from "@/generated";
import * as schema from "../ponder.schema";

ponder.on("WETH:Deposit", async ({ event, context }) => {
  await context.db.insert(schema.depositEvent).values({
    id: event.log.id,
    account: event.args.dst,
    amount: event.args.wad,
    timestamp: Number(event.block.timestamp),
  });
});
