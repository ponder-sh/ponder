import { ponder } from "@/generated";

ponder.on("ArtGobblers:Transfer", async ({ event, context }) => {
  await context.entities.Account.upsert(event.params.from, {});

  await context.entities.Account.upsert(event.params.to, {});

  await context.entities.Token.upsert(event.params.id, {
    owner: event.params.to,
  });
});
