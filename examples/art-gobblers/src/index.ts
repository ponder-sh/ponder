import { ponder } from "@/generated";

ponder.on("ArtGobblers:ArtGobbled", async ({ event, context }) => {
  throw new Error("kek");

  await context.entities.GobbledArt.insert(
    `${event.params.nft}-${event.params.id}`,
    {
      user: event.params.user,
    }
  );
});
