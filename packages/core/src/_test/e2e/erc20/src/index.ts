// @ts-ignore
import { ponder } from "@/generated";

// biome-ignore lint/suspicious/noRedeclare: :)
declare const ponder: import("@/index.js").Virtual.Registry<
  typeof import("../ponder.config.js").default,
  typeof import("../ponder.schema.js").default
>;

ponder.on("Erc20:Transfer", async ({ event, context }) => {
  await context.db.Account.upsert({
    id: event.args.from,
    create: {
      balance: -event.args.amount,
    },
    update: ({ current }) => ({
      balance: current.balance - event.args.amount,
    }),
  });

  await context.db.Account.upsert({
    id: event.args.to,
    create: {
      balance: event.args.amount,
    },
    update: ({ current }) => ({
      balance: current.balance + event.args.amount,
    }),
  });
});
