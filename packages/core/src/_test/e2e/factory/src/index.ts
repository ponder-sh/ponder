declare const ponder: import("@/index.js").Virtual.Registry<
  typeof import("../ponder.config.js").default,
  typeof import("../ponder.schema.js")
>;

declare const schema: typeof import("../ponder.schema.js");

// @ts-ignore
// biome-ignore lint/suspicious/noRedeclare: <explanation>
import { ponder } from "ponder:registry";
// @ts-ignore
// biome-ignore lint/suspicious/noRedeclare: <explanation>
import schema from "ponder:schema";

ponder.on("Pair:Swap", async ({ event, context }) => {
  await context.db.insert(schema.swapEvent).values({
    id: event.id,
    pair: event.log.address,
    from: event.args.sender,
    to: event.args.to,
  });
});
