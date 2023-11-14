import { ponder } from "@/generated";

ponder.on("AstariaRouter:Liquidation", async ({ event, context }) => {
  const { LiquidationEvent } = context.models;

  await LiquidationEvent.create({
    id: event.log.id,
    data: {
      liquidator: event.params.liquidator,
    },
  });
});

ponder.on("AstariaRouter:OwnershipTransferred", async ({ event, context }) => {
  const { OwnershipTransferredEvent } = context.models;

  await OwnershipTransferredEvent.create({
    id: event.log.id,
    data: {
      newOwner: event.params.newOwner,
    },
  });
});
