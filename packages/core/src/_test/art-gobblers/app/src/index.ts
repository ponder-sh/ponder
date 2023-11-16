// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { ponder } from "@/generated";

declare const ponder: import("@/index.js").PonderApp<
  typeof import("../ponder.config.ts").default,
  typeof import("../ponder.schema.ts").default
>;

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
ponder.on("setup", async ({ context }) => {
  const { SetupEntity } = context.db;

  await SetupEntity.upsert({
    id: "setup_id",
    create: undefined,
    update: undefined,
  });
});

ponder.on("ArtGobblers:Transfer", async ({ event, context }) => {
  const { Account, Token } = context.db;

  await Account.upsert({
    id: event.args.from,
    create: undefined,
    update: undefined,
  });

  await Account.upsert({
    id: event.args.to,
    create: undefined,
    update: undefined,
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
