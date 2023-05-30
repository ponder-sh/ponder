import { ponder } from "@/generated";

ponder.on("setup", async ({ context }) => {
  const { SetupEntity } = context.entities;

  await SetupEntity.upsert({
    id: "setup_id",
    create: {},
    update: {},
  });
});

ponder.on("ArtGobblers:Transfer", async ({ event, context }) => {
  const { Account, Token } = context.entities;

  await Account.upsert({ id: event.params.from, create: {}, update: {} });

  await Account.upsert({ id: event.params.to, create: {}, update: {} });

  await Token.upsert({
    id: event.params.id,
    create: {
      owner: event.params.to,
    },
    update: {
      owner: event.params.to,
    },
  });
});
