import { ponder } from "ponder:registry";

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
