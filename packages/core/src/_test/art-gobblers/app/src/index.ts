// @ts-ignore
import { ponder } from "@/generated";

// biome-ignore lint/suspicious/noRedeclare: :)
declare const ponder: import("@/index.js").PonderApp<
  typeof import("../ponder.config.ts").default,
  typeof import("../ponder.schema.ts").default
>;

ponder.on("ArtGobblers:setup", async ({ context }) => {
  const { SetupEntity } = context.db;

  await SetupEntity.upsert({
    id: "setup_id",
  });
});

ponder.on("ArtGobblers:Transfer", async ({ event, context }) => {
  const { Account, Token } = context.db;

  await Account.upsert({
    id: event.args.from,
  });

  await Account.upsert({
    id: event.args.to,
  });

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
