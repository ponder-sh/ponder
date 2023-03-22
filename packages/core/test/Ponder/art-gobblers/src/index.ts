import { ponder } from "@/generated";

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
