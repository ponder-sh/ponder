import { ponder } from "@/generated";

ponder.on("ArtGobblers:GobblerClaimed", async ({ event, context }) => {
  await context.entities.Account.upsert(event.params.user, {});

  await context.entities.Token.upsert(event.params.gobblerId, {
    owner: event.params.user,
    claimedBy: event.params.user,
  });
});
