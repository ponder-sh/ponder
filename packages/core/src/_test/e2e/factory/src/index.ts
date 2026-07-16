declare const ponder: import("@/index.js").Virtual.Registry<
  typeof import("../ponder.config.js").default,
  typeof import("../ponder.schema.js")
>;

declare const schema: typeof import("../ponder.schema.js");

// @ts-expect-error
// biome-ignore lint/suspicious/noRedeclare: Generated registry imports intentionally shadow the local declarations.
import { ponder } from "ponder:registry";
// @ts-expect-error
// biome-ignore lint/suspicious/noRedeclare: Generated registry imports intentionally shadow the local declarations.
import schema from "ponder:schema";

ponder.on("Pair:Swap", async ({ event, context }) => {
  await context.db.insert(schema.swapEvent).values({
    id: event.id,
    pair: event.log.address,
    from: event.args.sender,
    to: event.args.to,
  });
});
