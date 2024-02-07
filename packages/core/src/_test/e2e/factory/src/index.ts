// @ts-ignore
import { ponder } from "@/generated";

// biome-ignore lint/suspicious/noRedeclare: :)
declare const ponder: import("@/index.js").Virtual.Registry<
  typeof import("../ponder.config.js").default,
  typeof import("../ponder.schema.js").default
>;

ponder.on("Pair:Swap", async ({ event, context }) => {
  await context.db.SwapEvent.create({
    id: event.log.id,
    data: {
      pair: event.log.address,
      from: event.args.sender,
      to: event.args.to,
    },
  });
});
