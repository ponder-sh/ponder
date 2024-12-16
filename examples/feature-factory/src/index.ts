import { ponder } from "ponder:registry";
import { childContract } from "../ponder.schema";

ponder.on("LlamaCore:ActionCreated", async ({ event }) => {
  console.log(
    `Handling ActionCreated event from LlamaCore @ ${event.log.address}`,
  );
});

ponder.on("LlamaPolicy:Initialized", async ({ event }) => {
  console.log(
    `Handling Initialized event from LlamaPolicy @ ${event.log.address}`,
  );
});

ponder.on("ChildContract:ValueUpdated", async ({ event, context }) => {
  const { child, updater, oldValue, newValue } = event.args;
  context.db.insert(childContract).values({
    id: child,
  });
  console.log(
    `Handling ValueUpdated event from ChildContract @ ${event.log.address}`,
  );
});
