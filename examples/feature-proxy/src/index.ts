import { ponder } from "@/generated";

ponder.on("AstariaRouter:Liquidation", async ({ event, context }) => {
  const { LiquidationEvent } = context.models;
  // Create a TransferEvent.
  await LiquidationEvent.create({
    id: event.log.id,
    data: {
      liquidator: event.params.liquidator,
    },
  });
});

// ponder.on("AstariaRouter:AdminChanged");
