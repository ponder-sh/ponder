import { ponder } from "@/generated";

ponder.on("setup", async ({ context }) => {
  const { SetupEntity } = context.db;

  await SetupEntity.upsert({
    id: "setup_id",
    create: {},
    update: {},
  });
});

ponder.on("ArtGobblers:Transfer", async ({ event, context }) => {
  const { Account, Token } = context.db;

  await Account.upsert({ id: event.args.from, create: {}, update: {} });

  await Account.upsert({ id: event.args.to, create: {}, update: {} });

  await Token.upsert({
    id: event.args.id,
    create: {
      ownerId: event.args.to,
    },
    update: {
      ownerId: event.args.to,
    },
  });
});
