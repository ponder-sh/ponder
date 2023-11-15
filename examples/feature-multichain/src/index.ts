import { ponder } from "@/generated";

ponder.on("weth9:Deposit", async ({ event, context }) => {
  const { Account } = context.db;

  await Account.upsert({
    id: event.args.dst,
    create: {
      balance: event.args.wad,
    },
    update: ({ current }) => ({
      balance: current.balance + event.args.wad,
    }),
  });
});
