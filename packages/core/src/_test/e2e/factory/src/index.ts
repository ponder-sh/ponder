// @ts-ignore
import { ponder } from "@/generated";
import * as schema from "../ponder.schema.js";

// biome-ignore lint/suspicious/noRedeclare: :)
declare const ponder: import("@/index.js").Virtual.Registry<
  typeof import("../ponder.config.js").default,
  typeof import("../ponder.schema.js")
>;

ponder.on("Pair:Swap", async ({ event, context }) => {
  await context.db.insert(schema.swapEvent).values({
    id: event.log.id,
    pair: event.log.address,
    from: event.args.sender,
    to: event.args.to,
  });
});
