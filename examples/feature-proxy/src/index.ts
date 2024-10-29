import { ponder } from "@/generated";
import * as schema from "../ponder.schema";

ponder.on("AstariaRouter:Liquidation", async ({ event, context }) => {
  await context.db
    .insert(schema.liquidationEvent)
    .values({ liquidator: event.args.liquidator });
});

ponder.on("AstariaRouter:OwnershipTransferred", async ({ event, context }) => {
  await context.db
    .insert(schema.ownershipTransferEvent)
    .values({ newOwner: event.args.newOwner });
});
