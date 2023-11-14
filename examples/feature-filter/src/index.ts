import { ponder } from "@/generated";

ponder.on("PrimitiveManager:Swap", async ({ event, context }) => {
  const { SwapEvent } = context.models;

  await SwapEvent.create({
    id: event.log.id,
    data: {
      payer: event.params.payer,
      recipient: event.params.recipient,
    },
  });
});
