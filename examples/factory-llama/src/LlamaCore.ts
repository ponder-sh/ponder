import { ponder } from "@/generated";

ponder.on("LlamaCore:ActionCreated", async ({ event }) => {
  console.log(
    `Handling ActionCreated event from LlamaCore @ ${event.log.address}`
  );
});
