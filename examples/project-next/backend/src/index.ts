import { ponder } from "@/generated";

ponder.on("WETH:Deposit", async ({ event, context }) => {
  const { DepositEvent } = context.db;

  await DepositEvent.create({
    id: event.log.id,
    data: {
      account: event.args.dst,
      amount: event.args.wad,
      timestamp: Number(event.block.timestamp),
    },
  });
});
