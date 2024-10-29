import { ponder } from "@/generated";
import * as schema from "../ponder.schema";

ponder.on("Counter:Incremented", async ({ event, context }) => {
  await context.db.insert(schema.counter).values({
    value: Number(event.args.value),
    block: Number(event.block.number),
  });
});
