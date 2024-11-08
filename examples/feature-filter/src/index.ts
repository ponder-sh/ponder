import { ponder } from "@/generated";
import * as schema from "../ponder.schema";

ponder.on("PrimitiveManager:Swap", async ({ event, context }) => {
  await context.db.insert(schema.swapEvent).values({
    id: event.log.id,
    payer: event.args.payer,
    recipient: event.args.recipient,
  });
});
