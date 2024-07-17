import { ponder } from "@/generated";

ponder.on("PrimitiveManager:Swap", async ({ event, context }) => {
  const { SwapEvent } = context.db;

  await SwapEvent.create({
    id: event.log.id,
    data: {
      payer: event.args.payer,
      recipient: event.args.recipient,
    },
  });
});
