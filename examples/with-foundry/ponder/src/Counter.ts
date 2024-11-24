import schema from "ponder:schema";
import { ponder } from "@/generated";

ponder.on("Counter:Incremented", async ({ event, context }) => {
  await context.db.insert(schema.counter).values({
    value: Number(event.args.value),
    block: Number(event.block.number),
  });
});
