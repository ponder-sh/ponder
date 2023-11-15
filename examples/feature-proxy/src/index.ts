import { ponder } from "@/generated";

ponder.on("AstariaRouter:Liquidation", async ({ event, context }) => {
  const { LiquidationEvent } = context.db;

  await LiquidationEvent.create({
    id: event.log.id,
    data: {
      liquidator: event.args.liquidator,
    },
  });
});

ponder.on("AstariaRouter:OwnershipTransferred", async ({ event, context }) => {
  const { OwnershipTransferredEvent } = context.db;

  await OwnershipTransferredEvent.create({
    id: event.log.id,
    data: {
      newOwner: event.args.newOwner,
    },
  });
});
