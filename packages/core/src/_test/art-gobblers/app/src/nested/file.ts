import { ponder } from "@/generated";

ponder.on("ArtGobblers:GobblerClaimed", async ({ event, context }) => {
  const { Account, Token } = context.models;

  await Account.upsert({ id: event.args.user, create: {}, update: {} });

  await Token.upsert({
    id: event.args.gobblerId,
    create: {
      ownerId: event.args.user,
      claimedById: event.args.user,
    },
    update: {},
  });

  await Token.update({
    id: event.args.gobblerId,
    data: { ownerId: event.args.user },
  });

  const token = await Token.findUnique({ id: event.args.gobblerId });
  if (!token) throw new Error(`Token not found!`);

  await Token.delete({
    id: token.id,
  });

  await Token.create({
    id: token.id,
    data: {
      ownerId: event.args.user,
      claimedById: event.args.user,
    },
  });
});
