// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { ponder } from "@/generated";

declare const ponder: import("@/index.js").PonderApp<
  typeof import("../../ponder.config.ts").default,
  typeof import("../../ponder.schema.ts").default
>;

ponder.on("ArtGobblers:GobblerClaimed", async ({ event, context }) => {
  const { Account, Token } = context.db;

  await Account.upsert({
    id: event.args.user,
  });

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
