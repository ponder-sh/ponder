import { ponder } from "@/generated.js";

ponder.on("ArtGobblers:GobblerClaimed", async ({ event, context }) => {
  const { Account, Token } = context.entities;

  await Account.upsert({ id: event.params.user, create: {}, update: {} });

  await Token.upsert({
    id: event.params.gobblerId,
    create: {
      owner: event.params.user,
      claimedBy: event.params.user,
    },
    update: {},
  });

  await Token.update({
    id: event.params.gobblerId,
    data: { owner: event.params.user },
  });

  const token = await Token.findUnique({ id: event.params.gobblerId });
  if (!token) throw new Error(`Token not found!`);

  await Token.delete({
    id: token.id,
  });

  await Token.create({
    id: token.id,
    data: {
      owner: event.params.user,
      claimedBy: event.params.user,
    },
  });
});
